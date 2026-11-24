import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Buffer, createCipheriv, createDecipheriv, createHash, randomBytes } from 'react-native-quick-crypto';
import { isLegacySessionKey, migrateCredentials } from './credentialMigration';

// Sessions can exceed the iOS keychain's per-item size limit. Keep only a
// random AES key in SecureStore. Bind each encrypted value to its storage name.
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const keyName = (name: string) => 'campusclutch.key.' + createHash('sha256').update(name).digest('hex');
const encryptedName = (name: string) => 'campusclutch:sealed:v1:' + name;

export const credentialStorage = migrateCredentials({
  async getItem(name) {
    const value = await AsyncStorage.getItem(encryptedName(name));
    if (value === null) return null;
    const key = await SecureStore.getItemAsync(keyName(name), options);
    // Android can restore data without its installation's keystore keys.
    if (key === null) return null;
    const bytes = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  },
  async setItem(name, value) {
    let key = await SecureStore.getItemAsync(keyName(name), options);
    if (key === null) {
      key = randomBytes(32).toString('base64');
      await SecureStore.setItemAsync(keyName(name), key, options);
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
    cipher.setAAD(Buffer.from(name));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const envelope = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    await AsyncStorage.setItem(encryptedName(name), envelope.toString('base64'));
  },
  async removeItem(name) {
    await AsyncStorage.removeItem(encryptedName(name));
    await SecureStore.deleteItemAsync(keyName(name), options);
  },
}, AsyncStorage);

export function sessionStorageForProject() {
  // An installed tester can switch backends without changing Android package.
  // Migrate exact SDK session keys and pending receipts from prior releases.
  let migration: Promise<unknown> | undefined;
  function ready() {
    migration ??= AsyncStorage.getAllKeys().then(keys => Promise.all(keys
      .filter(key => isLegacySessionKey(key) || key.startsWith('campusclutch:account-deletion:v1:'))
      .map(key => credentialStorage.getItem(key))))
      .catch(error => { migration = undefined; throw error; });
    return migration;
  }
  return {
    async getItem(key: string) { await ready(); return credentialStorage.getItem(key); },
    async setItem(key: string, value: string) { await ready(); await credentialStorage.setItem(key, value); },
    async removeItem(key: string) { await ready(); await credentialStorage.removeItem(key); },
  };
}
