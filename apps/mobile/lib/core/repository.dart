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

  /// What each open order I handle needs now (`needs: { title, due, late }`), late ones first.
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

  /// Orders with their stage, money due and what each needs now (`needs: { title, due, late }`).
  /// [status]: open (Confirmed, In production, Shipped; the default) | closed (Done) | cancelled.
  /// [stage]: confirmed | in_production | shipped | done.
  Future<List<Json>> orders({bool mine = false, bool late = false, String? status, String? stage}) =>
      api.getList('/api/orders', query: {if (mine) 'mine': 'true', if (late) 'late': 'true', 'status': status, 'stage': stage});

  /// The order: `stage`, `next` (the one button), `back`, `money`, `needs`, `history`, `documents`,
  /// `lines` (each with `factory`, `receivedQty`, `receivedOn`, `packing`) and `goods` (received, packed).
  Future<Json> order(String id) => api.get('/api/orders/$id');

  /// One stage forward or back: `{ to, confirm?, note?, readyOn?, shippedOn?, blNo? }`. Returns the order.
  /// A move with warnings throws an [ApiException] with code "confirm" (see [ApiException.needsConfirm]):
  /// show the warnings and send it again with [confirm] true.
  Future<Json> moveOrder(String orderId, String to, {bool confirm = false, String? note, String? readyOn, String? shippedOn, String? blNo}) {
    String? clean(String? v) => v == null || v.trim().isEmpty ? null : v.trim();
    return api.post('/api/orders/$orderId/stage', {
      'to': to,
      if (confirm) 'confirm': true,
      'note': ?clean(note),
      'readyOn': ?clean(readyOn),
      'shippedOn': ?clean(shippedOn),
      'blNo': ?clean(blNo),
    });
  }

  /// How many of each goods line came in from the factory so far: [received] is lineId → the
  /// total received (not an addition), [on] the day (today when left out). Returns the order,
  /// with `lines[].receivedQty / receivedOn` and `goods` updated. More than ordered is a 400.
  Future<Json> recordReceipt(String orderId, Map<String, num> received, {String? on}) => api.put('/api/orders/$orderId/receipt', {
        if (on != null && on.isNotEmpty) 'on': on,
        'lines': [for (final e in received.entries) {'lineId': e.key, 'receivedQty': e.value}],
      });

  /// Money in from the customer: `{ currency, total, received, due, depositDue, status, payments: [...] }`.
  Future<Json> payments(String orderId) => api.get('/api/orders/$orderId/payments');

  /// The data printed on an order's document: [kind] proforma | invoice | packing-list.
  Future<Json> orderDocument(String orderId, String kind) => api.get('/api/orders/$orderId/documents/$kind');

  /* ---------------------------------------------------------------- PDFs */

  /// Where the web app makes a document's PDF. [kind]: revisions (id = revision id) or
  /// proforma | invoice | packing-list (id = order id). Same server as the API.
  static String pdfPath(String kind, String id) => '/pdf/$kind/$id';

  /// The PDF itself, downloaded with this app's session (bearer).
  Future<PdfFile> pdf(String kind, String id, {void Function(double)? onProgress}) => api.getPdf(pdfPath(kind, id), onProgress: onProgress);

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
