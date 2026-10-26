import 'api.dart';
import 'json.dart';

/// Every call the app makes to the Kebo API, in one place (screens and tests use this,
/// never raw paths). Responses stay plain JSON maps; see the API's services for shapes.
class KeboRepository {
  KeboRepository(this.api);
  final Api api;

  /* ---------------------------------------------------------------- auth */

  /// `{ token, twoStepRequired, user }`. With two-step on, `user` is null until [twoStep].
  Future<Json> login(String email, String password) => api.post('/api/auth/login', {'email': email.trim(), 'password': password});

  /// Second step with the token from [login] (sent as the bearer): `{ user, recoveryCodesLeft, usedRecoveryCode }`.
  Future<Json> twoStep(String code) => api.post('/api/auth/two-step', {'code': code.trim()});

  /// `{ id, name, email, role, permissions }`.
  Future<Json> me() => api.get('/api/auth/me');

  Future<void> logout() => api.post('/api/auth/logout');

  Future<void> registerDevice(String token, String platform) => api.post('/api/me/devices', {'token': token, 'platform': platform});
  Future<void> forgetDevice(String token) => api.delete('/api/me/devices', {'token': token});

  Future<Json> changePassword(String current, String next) => api.post('/api/me/password', {'current': current, 'next': next});

  Future<Json> twoStepStatus() => api.get('/api/me/two-step');
  Future<Json> twoStepSetup() => api.post('/api/me/two-step/setup');
  Future<Json> twoStepConfirm(String code) => api.post('/api/me/two-step/confirm', {'code': code.trim()});
  Future<Json> twoStepNewCodes(String code) => api.post('/api/me/two-step/recovery-codes', {'code': code.trim()});
  Future<Json> twoStepOff(String code) => api.post('/api/me/two-step/off', {'code': code.trim()});

  /* ---------------------------------------------------------------- home */

  /// `{ today, counts, todo, myDeals, newDeals, expiringQuotes, money?, workload? }`.
  Future<Json> dashboard() => api.get('/api/dashboard');

  /// The next step of every open order I handle, late ones first.
  Future<List<Json>> todo() => api.getList('/api/me/todo');

  /* ---------------------------------------------------------------- deals */

  /// `{ rows, total, page, pageSize, counts }`. [stage]: open|new|sourcing|quoted|won|lost|on_hold|overdue.
  Future<Json> deals({String? stage, String? q, String? assignee, int page = 1, String? sort}) =>
      api.get('/api/inquiries', query: {'stage': stage, 'q': q, 'assignee': assignee, 'page': page, 'sort': sort});

  Future<Json> deal(String id) => api.get('/api/inquiries/$id');

  /// [body]: `{ customerId, contactId?, channel, category, title?, requirements?, priority, requiredBy?, assigneeId?, items: [...] }`.
  Future<Json> createDeal(Json body) => api.post('/api/inquiries', body);

  Future<Json> addNote(String dealId, String body) => api.post('/api/inquiries/$dealId/notes', {'body': body.trim()});

  /// `{ to: lost|sourcing, lostReason?, note? }`: mark lost, start working, or reopen. Returns the deal.
  Future<Json> moveStage(String dealId, String to, {String? lostReason, String? note}) =>
      api.post('/api/inquiries/$dealId/stage', {'to': to, 'lostReason': ?lostReason, if (note != null && note.trim().isNotEmpty) 'note': note.trim()});

  Future<Json> markLost(String dealId, String reason, {String? note}) => moveStage(dealId, 'lost', lostReason: reason, note: note);
  Future<Json> reopen(String dealId, {String? note}) => moveStage(dealId, 'sourcing', note: note);

  Future<Json> hold(String dealId, bool onHold, {String? note}) =>
      api.post('/api/inquiries/$dealId/hold', {'onHold': onHold, if (note != null && note.trim().isNotEmpty) 'note': note.trim()});

  /// Managers assign anyone (null = nobody); staff may take unassigned work for themselves.
  Future<Json> assign(String dealId, String? assigneeId) => api.post('/api/inquiries/$dealId/assign', {'assigneeId': assigneeId});

  Future<Json> uploadFile(String dealId, {required String name, required String path, void Function(double)? onProgress}) =>
      api.uploadFile(dealId, name: name, path: path, onProgress: onProgress);

  /// Download path of a deal's file.
  static String filePath(String fileId) => '/api/files/$fileId';

  /// Active people for "assign to": `[{ id, name, role }]`.
  Future<List<Json>> people() => api.getList('/api/users/people');

  /// Company, sales (categories, currency…), plan and reminder settings.
  Future<Json> settings() => api.get('/api/settings');

  /* ---------------------------------------------------------------- quotation */

  /// `{ inquiry, quotation, revisions: [...newest first], canStartRevision, whyNotStart }`.
  Future<Json> quotation(String dealId) => api.get('/api/inquiries/$dealId/quotation');

  /// `{ to: sent|accepted|rejected|expired, on? }`. Accepted makes the order.
  Future<Json> revisionStatus(String revisionId, String to, {String? on}) => api.post('/api/revisions/$revisionId/status', {'to': to, 'on': ?on});

  /* ---------------------------------------------------------------- orders */

  /// Open orders by default, each with its stage, next step and progress.
  Future<List<Json>> orders({bool mine = false, bool overdue = false, String? status}) =>
      api.getList('/api/orders', query: {if (mine) 'mine': 'true', if (overdue) 'overdue': 'true', 'status': status});

  /// The order, its money position and its checklist (`plan.steps`, `plan.next`).
  Future<Json> order(String id) => api.get('/api/orders/$id');

  /// `{ action: done|skip|undo, key, on?, note? }`. Returns the updated order.
  Future<Json> step(String orderId, String action, String key, {String? on, String? note}) => api.post('/api/orders/$orderId/steps', {
        'action': action,
        'key': key,
        'on': ?on,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      });

  /// `{ currency, customer: {...}, payments: [...] }`.
  Future<Json> payments(String orderId) => api.get('/api/orders/$orderId/payments');
  Future<List<Json>> factoryOrders(String orderId) => api.getList('/api/orders/$orderId/factory-orders');
  Future<List<Json>> invoices(String orderId) => api.getList('/api/orders/$orderId/invoices');

  /// `{ remaining: [...], shipments: [...] }`.
  Future<Json> shipments(String orderId) => api.get('/api/orders/$orderId/shipments');

  /* ---------------------------------------------------------------- customers */

  Future<Json> customers({String? q, int page = 1}) => api.get('/api/customers', query: {'q': q, 'page': page});
  Future<Json> customer(String id) => api.get('/api/customers/$id');

  /// A 409 with code "duplicate" lists `matches`; send again with [allowDuplicate] to save anyway.
  Future<Json> createCustomer(Json body, {bool allowDuplicate = false}) => api.post('/api/customers', {...body, if (allowDuplicate) 'allowDuplicate': true});

  /* ---------------------------------------------------------------- notifications */

  /// `{ unread, items: [...] }`.
  Future<Json> notifications({bool unreadOnly = false}) => api.get('/api/notifications', query: {if (unreadOnly) 'unread': 'true'});

  Future<Json> markRead(List<String> ids) => api.post('/api/notifications/read', {'ids': ids});
  Future<Json> markAllRead() => api.post('/api/notifications/read', {'ids': 'all'});
}
