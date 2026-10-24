/// API responses are plain JSON maps. These helpers read them safely
/// (a missing or differently-typed field gives a sensible default instead of a crash).
typedef Json = Map<String, dynamic>;

extension JsonRead on Json {
  String s(String key, [String fallback = '']) {
    final v = this[key];
    if (v == null) return fallback;
    return v is String ? v : v.toString();
  }

  String? sn(String key) {
    final v = this[key];
    if (v == null) return null;
    final str = v is String ? v : v.toString();
    return str.isEmpty ? null : str;
  }

  num n(String key, [num fallback = 0]) {
    final v = this[key];
    if (v is num) return v;
    if (v is String) return num.tryParse(v) ?? fallback;
    return fallback;
  }

  int i(String key, [int fallback = 0]) => n(key, fallback).toInt();

  bool b(String key, [bool fallback = false]) {
    final v = this[key];
    if (v is bool) return v;
    if (v is String) return v == 'true';
    return fallback;
  }

  Json m(String key) {
    final v = this[key];
    return v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
  }

  Json? mn(String key) {
    final v = this[key];
    return v is Map ? v.cast<String, dynamic>() : null;
  }

  List<Json> l(String key) {
    final v = this[key];
    if (v is! List) return const [];
    return v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
  }

  List<String> ls(String key) {
    final v = this[key];
    if (v is! List) return const [];
    return v.map((e) => e.toString()).toList();
  }
}
