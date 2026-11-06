'use strict';

const HandlerPattern = require('./handlerpattern');
const STOPPED = 2;
const OPENING = 1;
const CLOSING = 0;
const ECHO_WINDOW_MS = 2000;
const shutdownHandlers = new WeakMap();

/** Rollo-Händler: absolute DPT5.001 targets with end-of-travel feedback. */
class RolloHandler extends HandlerPattern {
    onServiceInit() {
        // Run our synchronous enqueue/state update before HAP commits the write.
        // Acknowledgement still never waits for debounce, transport or travel.
        this.homekitUpdateBeforeAck = true;
        this.invert = this.booleanConstant('InvertPosition', true);
        this.estimate = this.booleanConstant('EstimatePosition', false);
        this.upMs = this.durationConstant('TravelTimeUpMs', 17000);
        this.downMs = this.durationConstant('TravelTimeDownMs', 17000);
        this.reserveMs = this.durationConstant('FeedbackTimeoutMs', 5000);
        this.debounceMs = this.durationConstant('CommandDebounceMs', 500, true);
        this.pendingCommand = undefined;
        // Neither HAP defaults nor restored values are fresh bus feedback.
        this.confirmedPosition = undefined;
        this.positionKnown = false;
        this.estimatedPosition = undefined;
        this.motion = undefined;
        this.ownCommands = [];
        this.closed = false;
        this.publish('PositionState', STOPPED);
        const api = this.myAPI.serviceKNX.globs.API;
        if (!shutdownHandlers.has(api)) {
            const handlers = new Set();
            shutdownHandlers.set(api, handlers);
            api.once('shutdown', () => {
                for (const handler of handlers) handler.onShutdown();
                shutdownHandlers.delete(api);
            });
        }
        shutdownHandlers.get(api).add(this);
        // KNXReadRequests uses the platform's existing paced startup read queue.
    }

    booleanConstant(name, fallback) {
        const value = this.myAPI.getLocalConstant(name);
        if (value === undefined) return fallback;
        if (typeof value !== 'boolean') throw new Error(`RolloHandler: ${name} must be a boolean`);
        return value;
    }

    durationConstant(name, fallback, allowZero = false) {
        const value = this.myAPI.getLocalConstant(name);
        if (value === undefined) return fallback;
        // Keep both travel+reserve and individual timers within Node's timer range.
        if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0) || value > 86400000) {
            throw new Error(`RolloHandler: ${name} must be milliseconds in ${allowZero ? '[' : '('}0, 86400000]`);
        }
        return value;
    }

    position(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
            ? Math.round(value) : undefined;
    }

    convert(value) {
        return this.invert ? 100 - value : value;
    }

    warn(message) {
        this.myAPI.serviceKNX.globs.log.warn(`[RolloHandler: ${this.myAPI.serviceKNX.name}] ${message}`);
    }

    publish(field, value) {
        if (this.myAPI.getValue(field) !== value) this.myAPI.setValue(field, value);
    }

    positionAt(now) {
        const motion = this.motion;
        if (!motion) return this.positionKnown ? this.confirmedPosition : undefined;
        if (motion.start === undefined) return undefined;
        const distance = Math.max(0, now - motion.startedAt) * 100 / motion.fullMs;
        return motion.target >= motion.start
            ? Math.min(motion.target, motion.start + distance)
            : Math.max(motion.target, motion.start - distance);
    }

    clearMotion() {
        if (this.motion) {
            clearTimeout(this.motion.tick);
            clearTimeout(this.motion.deadline);
        }
        this.motion = undefined;
        this.estimatedPosition = undefined;
    }

    onHKValueChange(field, oldValue, newValue) {
        if (this.closed || field !== 'TargetPosition') return;
        const target = this.position(newValue);
        if (target === undefined) {
            this.warn(`Ignoring invalid HomeKit target: ${String(newValue)}`);
            return;
        }
        this.cancelPendingCommand();
        if (this.debounceMs === 0) {
            this.sendTarget(target);
            return;
        }
        // HomeKit can show the requested target, but the old journey continues
        // until we actually send. Each handler owns its own debounce timer.
        this.publish('TargetPosition', target);
        const pending = { target };
        this.pendingCommand = pending;
        pending.timer = setTimeout(() => {
            if (this.pendingCommand !== pending || this.closed) return;
            this.pendingCommand = undefined;
            this.sendTarget(target);
        }, this.debounceMs);
    }

    cancelPendingCommand() {
        if (this.pendingCommand) clearTimeout(this.pendingCommand.timer);
        this.pendingCommand = undefined;
    }

    sendTarget(target) {
        if (this.motion && target === this.motion.target) return;
        const motion = this.beginMotion(target);
        const now = Date.now();
        this.ownCommands = this.ownCommands.filter(command => command.expires > now);
        this.ownCommands.push({ target, expires: now + ECHO_WINDOW_MS });
        try {
            this.myAPI.knxWrite('TargetPosition', this.convert(target), 'DPT5.001', error => {
                if (error && this.motion === motion && !this.closed) {
                    this.warn(`KNX target write failed: ${error.message || error}`);
                    this.failMotion();
                }
            });
        } catch (error) {
            if (this.motion === motion) {
                this.warn(`KNX target write failed: ${error.message || error}`);
                this.failMotion();
            }
        }
    }

    onKNXValueChange(field, oldValue, newValue, metadata) {
        if (this.closed || (field !== 'CurrentPosition' && field !== 'TargetPosition')) return;
        // customServiceAPI has already normalized knxd bytes to percentages.
        const raw = this.position(newValue);
        if (raw === undefined) {
            this.warn(`Ignoring invalid KNX ${field}: ${String(newValue)}`);
            return;
        }
        const position = Math.round(this.convert(newValue));
        if (field === 'CurrentPosition') {
            if (this.motion) {
                const event = metadata?.event;
                // A read response (including startup reads) is not an end-of-
                // travel notification. Only a value near the target can confirm
                // it. Explicit writes remain authoritative even when
                // they report the starting position (e.g. an aborted drive).
                const uncertainResponse = event === 'GroupValue_Response'
                    && Math.abs(this.motion.target - position) >= 2;
                const untypedOldValue = this.motion.queryPending && !event && position === this.confirmedPosition;
                if (uncertainResponse || untypedOldValue) return;
            }
            if (this.motion && Math.abs(this.motion.target - position) >= 2) {
                this.warn(`End position ${position}% differs from requested ${this.motion.target}%`);
            }
            this.clearMotion();
            this.confirmedPosition = position;
            this.positionKnown = true;
            this.publish('CurrentPosition', position);
            this.publish('TargetPosition', this.pendingCommand?.target ?? position);
            this.publish('PositionState', STOPPED);
            return;
        }
        const now = Date.now();
        this.ownCommands = this.ownCommands.filter(command => command.expires > now);
        if (this.ownCommands.some(command => command.target === position)) return;
        this.cancelPendingCommand();
        if ((this.motion && this.motion.target === position)
            || (!this.motion && this.positionKnown && position === this.confirmedPosition)) {
            this.publish('TargetPosition', position);
            return;
        }
        this.beginMotion(position); // An external absolute target; never echo it to KNX.
    }

    beginMotion(target) {
        const now = Date.now();
        const start = this.positionAt(now);
        this.clearMotion();
        const direction = start === undefined
            ? (target === 100 ? OPENING : target === 0 ? CLOSING : STOPPED)
            : target > start ? OPENING : target < start ? CLOSING : STOPPED;
        const fullMs = direction === OPENING ? this.upMs
            : direction === CLOSING ? this.downMs : Math.max(this.upMs, this.downMs);
        const duration = start === undefined ? Math.max(this.upMs, this.downMs)
            : Math.abs(target - start) * fullMs / 100;
        const motion = { target, start, startedAt: now, fullMs };
        this.motion = motion;
        // Publish direction before the sent target to avoid a new target with
        // the previous STOPPED state in the synchronous HAP event sequence.
        this.publish('PositionState', direction);
        this.publish('TargetPosition', target);
        if (this.estimate && start !== undefined && duration > 0) this.scheduleEstimate(motion);
        motion.deadline = setTimeout(() => {
            if (this.motion !== motion || this.closed) return;
            motion.queryPending = true;
            // Arm before reading: even a synchronous response must cancel this timer.
            motion.deadline = setTimeout(() => {
                if (this.motion !== motion || this.closed) return;
                this.warn('No end-position feedback after read request; position is unconfirmed. No retry movement sent.');
                this.failMotion();
            }, this.reserveMs);
            try {
                this.myAPI.knxReadRequest('CurrentPosition', error => {
                    if (error && this.motion === motion && !this.closed) {
                        this.warn(`Position read request failed: ${error.message || error}`);
                    }
                });
            } catch (error) {
                this.warn(`Position read request failed: ${error.message || error}`);
            }
        }, Math.ceil(fullMs + this.reserveMs));
        return motion;
    }

    scheduleEstimate(motion) {
        motion.tick = setTimeout(() => {
            if (this.motion !== motion || this.closed) return;
            const position = this.positionAt(Date.now());
            this.estimatedPosition = position;
            this.publish('CurrentPosition', Math.round(position));
            if (position !== motion.target) this.scheduleEstimate(motion);
            // Reaching the computed target does not confirm arrival or stop supervision.
        }, 1000);
    }

    failMotion() {
        this.clearMotion();
        this.positionKnown = false;
        // Freeze the last displayed value, still unconfirmed. Rolling it back
        // to an older confirmation would manufacture another position change.
        this.publish('PositionState', STOPPED);
    }

    onShutdown() {
        this.closed = true;
        this.cancelPendingCommand();
        shutdownHandlers.get(this.myAPI.serviceKNX.globs.API)?.delete(this);
        this.clearMotion();
        this.ownCommands = [];
    }
}

module.exports = RolloHandler;
