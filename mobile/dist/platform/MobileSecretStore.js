/**
 * Minimal secret-storage interface and implementations for Mobile.
 *
 * Primary implementation uses Capacitor's @capacitor/preferences API
 * (async key-value store backed by Keychain on iOS / EncryptedSharedPreferences
 * on Android). Falls back to localStorage when Capacitor is not available
 * (e.g., browser dev environment or unit tests).
 */
/**
 * Returns a SecretStore backed by Capacitor Preferences when available,
 * or localStorage when running outside a Capacitor context.
 */
export function createMobileSecretStore() {
    const prefs = typeof window !== 'undefined' ? window._capacitorPreferences : undefined;
    if (prefs) {
        return new CapacitorSecretStore(prefs);
    }
    return new LocalStorageSecretStore();
}
class CapacitorSecretStore {
    constructor(prefs) {
        this.prefs = prefs;
    }
    async get(key) {
        const { value } = await this.prefs.get({ key });
        return value;
    }
    async set(key, value) {
        await this.prefs.set({ key, value });
    }
    async delete(key) {
        await this.prefs.remove({ key });
    }
}
class LocalStorageSecretStore {
    constructor() {
        this.prefix = 'obsidian-remote-ssh:';
    }
    async get(key) {
        return localStorage.getItem(this.prefix + key);
    }
    async set(key, value) {
        localStorage.setItem(this.prefix + key, value);
    }
    async delete(key) {
        localStorage.removeItem(this.prefix + key);
    }
}
//# sourceMappingURL=MobileSecretStore.js.map