import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/json.dart';
import '../../../core/providers.dart';

/// Customers or factories, a page of 50 for a search.
final partnersProvider = FutureProvider.autoDispose.family<List<Json>, (String, String)>((ref, k) async {
  final (kind, q) = k;
  final api = ref.watch(sessionProvider.notifier).api;
  return (await api.get(
    '/api/$kind',
    query: {if (q.trim().isNotEmpty) 'q': q.trim(), 'pageSize': 50},
  )).list('rows', (m) => m);
});

final customerProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async {
  return ref.watch(sessionProvider.notifier).api.get('/api/customers/$id');
});

final factoryProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async {
  return ref.watch(sessionProvider.notifier).api.get('/api/factories/$id');
});

/// The contact to reach: the primary one, else the first.
Json? mainContact(Json p) =>
    p.objAt('primaryContact') ??
    p.list('contacts', (m) => m).where((c) => c['isPrimary'] == true).firstOrNull ??
    p.list('contacts', (m) => m).firstOrNull;
