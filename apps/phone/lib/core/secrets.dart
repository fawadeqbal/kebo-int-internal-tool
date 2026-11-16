import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the sign-in token and server address live: the phone's keystore / keychain.
/// Never fails loudly: a phone that can't read its keystore just signs in again.
abstract class Secrets {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SecureSecrets implements Secrets {
  const SecureSecrets([this._s = const FlutterSecureStorage()]);
  final FlutterSecureStorage _s;

  @override
  Future<String?> read(String key) => _s.read(key: key).catchError((_) => null);
  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value).catchError((_) {});
  @override
  Future<void> delete(String key) => _s.delete(key: key).catchError((_) {});
}

/// For tests and the web preview.
class MemorySecrets implements Secrets {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}
