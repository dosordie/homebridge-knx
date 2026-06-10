'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const yaml = require('js-yaml');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

const PLUGIN_ALIAS = 'KNX';
const SUPPORTED_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);
const BACKUP_LIMIT = 10;
const DEFAULT_ALLOWED_ROOT = '/var/lib/homebridge';

class KnxConfigUiServer extends HomebridgePluginUiServer {
    constructor() {
        super();

        this.onRequest('/platform-config/load', this.handlePlatformConfigLoadRequest.bind(this));
        this.onRequest('/platform-config/save', this.handlePlatformConfigSaveRequest.bind(this));
        this.onRequest('/external-config/metadata', this.handleConfigRequest.bind(this));
        this.onRequest('/external-config/load', this.handleLoadRequest.bind(this));
        this.onRequest('/external-config/validate', this.handleValidateRequest.bind(this));
        this.onRequest('/external-config/save', this.handleSaveRequest.bind(this));

        // Backwards-compatible aliases used by the first custom UI version.
        this.onRequest('/config', this.handleConfigRequest.bind(this));
        this.onRequest('/load', this.handleLoadRequest.bind(this));
        this.onRequest('/validate', this.handleValidateRequest.bind(this));
        this.onRequest('/save', this.handleSaveRequest.bind(this));

        this.ready();
    }


    log(message) {
        console.log(`[homebridge-knx config-ui] ${message}`);
    }


    async handlePlatformConfigLoadRequest() {
        const { platformConfig, index } = await this.getFirstKnxPlatformConfigWithDocument();

        return {
            index,
            config: this.toPlatformConfigResponse(platformConfig),
        };
    }

    async handlePlatformConfigSaveRequest(payload) {
        const { config, filePath } = await this.readHomebridgeConfig();
        const platforms = Array.isArray(config.platforms) ? config.platforms : [];
        const index = platforms.findIndex((entry) => entry && entry.platform === PLUGIN_ALIAS);

        if (index === -1) {
            throw this.requestError('No KNX platform config found in Homebridge config.json.', 404, 'KNX config not found');
        }

        const current = platforms[index];
        const updates = this.normalisePlatformConfigPayload(payload && payload.config ? payload.config : payload);
        const next = { ...current };

        for (const [key, value] of Object.entries(updates)) {
            next[key] = value;
        }

        next.platform = PLUGIN_ALIAS;
        platforms[index] = next;

        let content;
        try {
            content = `${JSON.stringify(config, null, 4)}\n`;
            JSON.parse(content);
        } catch (error) {
            this.log(`Validation failed for Homebridge config.json: ${error.message}`);
            throw this.requestError(`Invalid Homebridge config.json: ${error.message}`, 400, 'Invalid JSON');
        }

        try {
            const backupPath = await this.createBackup(filePath);
            await this.atomicWrite(filePath, content);
            await this.pruneBackups(filePath);

            this.log(`Saved KNX platform config in Homebridge config.json: ${filePath}`);
            return {
                saved: true,
                message: 'Homebridge restart required.',
                backup: path.basename(backupPath),
                config: this.toPlatformConfigResponse(next),
            };
        } catch (error) {
            this.log(`Unable to save Homebridge config ${filePath}: ${error.message}`);
            throw this.requestError(this.friendlyFsError(error, 'write'), 500, error.code || 'Save failed');
        }
    }

    normalisePlatformConfigPayload(payload) {
        const data = payload && typeof payload === 'object' ? payload : {};
        const updates = {};

        updates.name = this.normaliseOptionalString(data.name, 'name');
        updates.config_path = this.normaliseRequiredString(data.config_path, 'config_path');

        if (data.knxconnection !== 'knxd' && data.knxconnection !== 'knxjs') {
            throw this.requestError('knxconnection must be either knxd or knxjs.', 400, 'Invalid knxconnection');
        }
        updates.knxconnection = data.knxconnection;

        updates.knx_phy_addr = this.normaliseOptionalString(data.knx_phy_addr, 'knx_phy_addr');

        if (updates.knxconnection === 'knxd') {
            updates.knxd_ip = this.normaliseOptionalString(data.knxd_ip, 'knxd_ip');
            updates.knxd_port = this.normalisePort(data.knxd_port);
        }

        return updates;
    }

    normaliseRequiredString(value, fieldName) {
        if (typeof value !== 'string' || !value.trim()) {
            throw this.requestError(`${fieldName} must not be empty.`, 400, `Invalid ${fieldName}`);
        }

        return value.trim();
    }

    normaliseOptionalString(value, fieldName) {
        if (value === undefined || value === null) {
            return '';
        }

        if (typeof value !== 'string') {
            throw this.requestError(`${fieldName} must be a string.`, 400, `Invalid ${fieldName}`);
        }

        return value.trim();
    }

    normalisePort(value) {
        const port = Number(value);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw this.requestError('knxd_port must be a number between 1 and 65535.', 400, 'Invalid knxd_port');
        }

        return port;
    }

    toPlatformConfigResponse(platformConfig) {
        return {
            name: typeof platformConfig.name === 'string' ? platformConfig.name : '',
            config_path: typeof platformConfig.config_path === 'string' ? platformConfig.config_path : '',
            knxconnection: platformConfig.knxconnection === 'knxjs' ? 'knxjs' : 'knxd',
            knxd_ip: typeof platformConfig.knxd_ip === 'string' ? platformConfig.knxd_ip : '',
            knxd_port: platformConfig.knxd_port === undefined || platformConfig.knxd_port === null ? 6720 : platformConfig.knxd_port,
            knx_phy_addr: typeof platformConfig.knx_phy_addr === 'string' ? platformConfig.knx_phy_addr : '',
        };
    }

    async handleConfigRequest() {
        const platformConfig = await this.getFirstKnxPlatformConfig();
        const configPath = platformConfig.config_path;

        this.log(`Using KNX config_path: ${configPath || '(not configured)'}`);

        if (!configPath) {
            throw this.requestError('KNX platform config does not define config_path.', 400, 'Missing config_path');
        }

        const resolved = await this.resolveAllowedTarget(configPath);
        const stat = await this.safeStat(resolved.realPath);

        if (!stat) {
            throw this.requestError('File not found.', 404, 'File not found');
        }

        if (stat.isDirectory()) {
            const files = await this.listConfigFiles(resolved.realPath);
            return {
                configPath,
                mode: 'directory',
                files,
                message: files.length
                    ? 'Select a configuration file from this directory.'
                    : 'config_path points to a directory; no JSON/YAML files were found.',
            };
        }

        this.assertSupportedFile(resolved.realPath);

        return {
            configPath,
            mode: 'file',
            file: this.toFileResponse(resolved.realPath, resolved.realPath),
        };
    }

    async handleLoadRequest(payload) {
        const target = await this.resolveTargetFromPayload(payload);
        const stat = await this.safeStat(target.realPath);

        if (!stat) {
            throw this.requestError('File not found.', 404, 'File not found');
        }

        if (stat.isDirectory()) {
            const files = await this.listConfigFiles(target.realPath);
            return {
                mode: 'directory',
                files,
                message: files.length
                    ? 'Select a configuration file from this directory.'
                    : 'config_path points to a directory; no JSON/YAML files were found.',
            };
        }

        this.assertSupportedFile(target.realPath);

        try {
            const content = await fsp.readFile(target.realPath, 'utf8');
            this.log(`Loaded KNX config file: ${target.realPath}`);
            return {
                mode: 'file',
                file: this.toFileResponse(target.realPath, target.baseRealPath),
                content,
            };
        } catch (error) {
            this.log(`Unable to read KNX config file ${target.realPath}: ${error.message}`);
            throw this.requestError(this.friendlyFsError(error, 'read'), 500, error.code || 'Read failed');
        }
    }

    async handleValidateRequest(payload) {
        const target = await this.resolveTargetFromPayload(payload);
        this.assertSupportedFile(target.realPath);

        const content = typeof payload.content === 'string' ? payload.content : '';
        this.validateContent(target.realPath, content);

        return { valid: true, message: 'Configuration is valid.' };
    }

    async handleSaveRequest(payload) {
        const target = await this.resolveTargetFromPayload(payload);
        const stat = await this.safeStat(target.realPath);

        if (!stat) {
            throw this.requestError('File not found.', 404, 'File not found');
        }

        if (!stat.isFile()) {
            throw this.requestError('Selected path is not a file.', 400, 'Not a file');
        }

        this.assertSupportedFile(target.realPath);

        const content = typeof payload.content === 'string' ? payload.content : '';
        this.validateContent(target.realPath, content);

        let backupPath;
        try {
            backupPath = await this.createBackup(target.realPath);
            await this.writeExternalConfigFile(target.realPath, content);
        } catch (error) {
            this.log(`Unable to save KNX config file ${target.realPath}: ${error.message}`);
            throw this.requestError(this.friendlyFsError(error, 'write'), 500, error.code || 'Save failed');
        }

        await this.repairExternalConfigPermissions(target.realPath);

        try {
            await this.pruneBackups(target.realPath);
        } catch (error) {
            this.log(`Unable to prune backups for KNX config file ${target.realPath}: ${error.message}`);
        }

        this.log(`Saved KNX config file: ${target.realPath}`);
        return {
            saved: true,
            message: 'Configuration saved. Restart Homebridge after changes.',
            backup: path.basename(backupPath),
        };
    }

    async readHomebridgeConfig() {
        const filePath = this.getHomebridgeConfigPath();
        let rawConfig;

        try {
            rawConfig = await fsp.readFile(filePath, 'utf8');
        } catch (error) {
            this.log(`Unable to read Homebridge config ${filePath}: ${error.message}`);
            throw this.requestError('Unable to read Homebridge config.json.', 500, 'Config read failed');
        }

        try {
            return { config: JSON.parse(rawConfig), filePath };
        } catch (error) {
            this.log(`Invalid Homebridge config ${filePath}: ${error.message}`);
            throw this.requestError(`Invalid Homebridge config.json: ${error.message}`, 400, 'Invalid JSON');
        }
    }

    getHomebridgeConfigPath() {
        const filePath = this.homebridgeConfigPath || process.env.HOMEBRIDGE_CONFIG_PATH;

        if (!filePath || typeof filePath !== 'string') {
            throw this.requestError('Homebridge config path is not available.', 500, 'Config path unavailable');
        }

        return filePath;
    }

    async getFirstKnxPlatformConfigWithDocument() {
        const { config, filePath } = await this.readHomebridgeConfig();
        const platforms = Array.isArray(config.platforms) ? config.platforms : [];
        const index = platforms.findIndex((entry) => entry && entry.platform === PLUGIN_ALIAS);

        if (index === -1) {
            throw this.requestError('No KNX platform config found in Homebridge config.json.', 404, 'KNX config not found');
        }

        return { config, filePath, platformConfig: platforms[index], index };
    }

    async getFirstKnxPlatformConfig() {
        const { platformConfig } = await this.getFirstKnxPlatformConfigWithDocument();
        return platformConfig;
    }

    async resolveTargetFromPayload(payload) {
        const platformConfig = await this.getFirstKnxPlatformConfig();
        const configPath = platformConfig.config_path;

        if (!configPath) {
            throw this.requestError('KNX platform config does not define config_path.', 400, 'Missing config_path');
        }

        const base = await this.resolveAllowedTarget(configPath);
        const baseStat = await this.safeStat(base.realPath);

        if (!baseStat) {
            throw this.requestError('File not found.', 404, 'File not found');
        }

        if (baseStat.isDirectory()) {
            const selectedFile = payload && typeof payload.file === 'string' ? payload.file : '';
            if (!selectedFile) {
                return { realPath: base.realPath, baseRealPath: base.realPath };
            }

            if (path.isAbsolute(selectedFile) || this.containsParentTraversal(selectedFile)) {
                throw this.requestError('Invalid file selection.', 400, 'Invalid file');
            }

            const candidate = path.join(base.realPath, selectedFile);
            const realPath = await this.realpathOrRequestError(candidate);
            this.assertInside(realPath, [base.realPath]);
            this.assertSupportedFile(realPath);

            return { realPath, baseRealPath: base.realPath };
        }

        return { realPath: base.realPath, baseRealPath: base.realPath };
    }

    async resolveAllowedTarget(targetPath) {
        if (typeof targetPath !== 'string' || !targetPath.trim()) {
            throw this.requestError('config_path is empty.', 400, 'Invalid path');
        }

        if (!path.isAbsolute(targetPath) || this.containsParentTraversal(targetPath)) {
            throw this.requestError('Path outside allowed directory.', 403, 'Invalid path');
        }

        const realPath = await this.realpathOrRequestError(targetPath);
        const roots = await this.getAllowedRoots();
        this.assertInside(realPath, roots);

        return { realPath };
    }

    async getAllowedRoots() {
        const rootCandidates = [DEFAULT_ALLOWED_ROOT];

        if (this.homebridgeStoragePath) {
            rootCandidates.push(this.homebridgeStoragePath);
        }

        const roots = [];
        for (const root of rootCandidates) {
            try {
                const realRoot = await fsp.realpath(root);
                if (!roots.includes(realRoot)) {
                    roots.push(realRoot);
                }
            } catch (error) {
                if (root === DEFAULT_ALLOWED_ROOT) {
                    const fallbackRoot = path.resolve(root);
                    if (!roots.includes(fallbackRoot)) {
                        roots.push(fallbackRoot);
                    }
                }
            }
        }

        return roots;
    }

    async realpathOrRequestError(targetPath) {
        try {
            return await fsp.realpath(targetPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw this.requestError('File not found.', 404, 'File not found');
            }
            if (error.code === 'EACCES' || error.code === 'EPERM') {
                this.log(`Permission denied resolving path ${targetPath}: ${error.message}`);
                throw this.requestError('Permission denied.', 403, 'Permission denied');
            }
            throw this.requestError(this.friendlyFsError(error, 'access'), 500, error.code || 'Path error');
        }
    }

    assertInside(realPath, allowedRoots) {
        const inside = allowedRoots.some((root) => realPath === root || realPath.startsWith(`${root}${path.sep}`));

        if (!inside) {
            this.log(`Blocked KNX config path outside allowed roots: ${realPath}`);
            throw this.requestError('Path outside allowed directory.', 403, 'Path outside allowed directory');
        }
    }

    containsParentTraversal(targetPath) {
        return targetPath.split(/[\\/]+/).includes('..');
    }

    assertSupportedFile(filePath) {
        const extension = path.extname(filePath).toLowerCase();

        if (!SUPPORTED_EXTENSIONS.has(extension)) {
            throw this.requestError('Unsupported file type. Use .json, .yaml, or .yml.', 400, 'Unsupported file type');
        }
    }

    validateContent(filePath, content) {
        const extension = path.extname(filePath).toLowerCase();

        try {
            if (extension === '.json') {
                JSON.parse(content);
            } else if (extension === '.yaml' || extension === '.yml') {
                yaml.load(content);
            } else {
                this.assertSupportedFile(filePath);
            }
        } catch (error) {
            const message = this.validationErrorMessage(extension, error);
            this.log(`Validation failed for KNX config file ${filePath}: ${message}`);
            throw this.requestError(message, 400, extension === '.json' ? 'Invalid JSON' : 'Invalid YAML');
        }
    }

    validationErrorMessage(extension, error) {
        if (extension === '.json') {
            return `Invalid JSON: ${error.message}`;
        }

        if (error.mark) {
            return `Invalid YAML at line ${error.mark.line + 1}, column ${error.mark.column + 1}: ${error.reason || error.message}`;
        }

        return `Invalid YAML: ${error.message}`;
    }

    async createBackup(filePath) {
        const timestamp = new Date().toISOString()
            .replace(/T/, '-')
            .replace(/:/g, '')
            .replace(/\..+$/, '');
        const backupPath = `${filePath}.${timestamp}.bak`;

        await fsp.copyFile(filePath, backupPath, fs.constants.COPYFILE_EXCL);
        return backupPath;
    }

    async atomicWrite(filePath, content) {
        const directory = path.dirname(filePath);
        const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

        await fsp.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
        await fsp.rename(temporaryPath, filePath);
    }

    async writeExternalConfigFile(filePath, content) {
        // Keep the existing inode so file-specific ACLs/default ACL inheritance are not discarded.
        await fsp.writeFile(filePath, content, { encoding: 'utf8', mode: 0o664 });
    }

    async repairExternalConfigPermissions(filePath) {
        try {
            await this.inheritDirectoryGroupIfPossible(filePath);
        } catch (error) {
            this.log(`Unable to inherit group for KNX config file ${filePath}: ${error.message}`);
        }

        try {
            await fsp.chmod(filePath, 0o664);
        } catch (error) {
            this.log(`Unable to chmod KNX config file ${filePath}: ${error.message}`);
        }
    }

    async inheritDirectoryGroupIfPossible(filePath) {
        const directory = path.dirname(filePath);
        const [fileStat, directoryStat] = await Promise.all([
            fsp.stat(filePath),
            fsp.stat(directory),
        ]);

        if (fileStat.gid === directoryStat.gid) {
            return;
        }

        try {
            await fsp.chown(filePath, fileStat.uid, directoryStat.gid);
        } catch (error) {
            this.log(`Unable to inherit group for KNX config file ${filePath}: ${error.message}`);
        }
    }

    async pruneBackups(filePath) {
        const directory = path.dirname(filePath);
        const baseName = path.basename(filePath);
        const entries = await fsp.readdir(directory, { withFileTypes: true });
        const backups = [];

        for (const entry of entries) {
            if (entry.isFile() && entry.name.startsWith(`${baseName}.`) && entry.name.endsWith('.bak')) {
                const backupPath = path.join(directory, entry.name);
                const stat = await fsp.stat(backupPath);
                backups.push({ path: backupPath, mtimeMs: stat.mtimeMs });
            }
        }

        backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const oldBackups = backups.slice(BACKUP_LIMIT);

        await Promise.all(oldBackups.map((backup) => fsp.unlink(backup.path)));
    }

    async listConfigFiles(directoryPath) {
        const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
        const files = [];

        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }

            const extension = path.extname(entry.name).toLowerCase();
            if (!SUPPORTED_EXTENSIONS.has(extension)) {
                continue;
            }

            const realPath = await fsp.realpath(path.join(directoryPath, entry.name));
            this.assertInside(realPath, [directoryPath]);
            files.push(this.toFileResponse(realPath, directoryPath));
        }

        return files.sort((a, b) => a.name.localeCompare(b.name));
    }

    toFileResponse(realPath, baseRealPath) {
        const relative = realPath === baseRealPath ? path.basename(realPath) : path.relative(baseRealPath, realPath);

        return {
            name: path.basename(realPath),
            relative,
            path: realPath,
            extension: path.extname(realPath).toLowerCase(),
        };
    }

    async safeStat(targetPath) {
        try {
            return await fsp.stat(targetPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            if (error.code === 'EACCES' || error.code === 'EPERM') {
                this.log(`Permission denied accessing path ${targetPath}: ${error.message}`);
                throw this.requestError('Permission denied.', 403, 'Permission denied');
            }
            throw error;
        }
    }

    friendlyFsError(error, action) {
        if (error.code === 'ENOENT') {
            return 'File not found.';
        }
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            return 'Permission denied.';
        }
        return `Unable to ${action} file: ${error.message}`;
    }

    requestError(message, status, code) {
        return new RequestError(message, { status, code });
    }
}

(() => new KnxConfigUiServer())();
