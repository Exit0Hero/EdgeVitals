import * as SecureStore from 'expo-secure-store';

/** Native: Keychain (iOS) / Keystore-backed storage (Android). */
export const tokenStore = {
  get: (k: string) => SecureStore.getItemAsync(k),
  set: (k: string, v: string) =>
    SecureStore.setItemAsync(k, v, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  remove: (k: string) => SecureStore.deleteItemAsync(k),
};
