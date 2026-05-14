/**
 * Minimal secret-storage interface and implementations for Mobile.
 *
 * Primary implementation uses Capacitor's @capacitor/preferences API
 * (async key-value store backed by Keychain on iOS / EncryptedSharedPreferences
 * on Android). Falls back to localStorage when Capacitor is not available
 * (e.g., browser dev environment or unit tests).
 */
export interface SecretStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}
interface CapacitorPreferences {
    get(opts: {
        key: string;
    }): Promise<{
        value: string | null;
    }>;
    set(opts: {
        key: string;
        value: string;
    }): Promise<void>;
    remove(opts: {
        key: string;
    }): Promise<void>;
}
declare global {
    interface Window {
        _capacitorPreferences?: CapacitorPreferences;
    }
}
/**
 * Returns a SecretStore backed by Capacitor Preferences when available,
 * or localStorage when running outside a Capacitor context.
 */
export declare function createMobileSecretStore(): SecretStore;
export {};
//# sourceMappingURL=MobileSecretStore.d.ts.map