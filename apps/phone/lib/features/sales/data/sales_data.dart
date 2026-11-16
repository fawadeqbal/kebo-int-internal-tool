import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';

/// A row of the inquiries list.
class InquiryRow {
  const InquiryRow({
    required this.id,
    required this.refNo,
    this.title,
    this.category,
    this.stage,
    this.priority = 'normal',
    this.customer,
    this.assignee,
    this.requiredBy,
    this.overdue = false,
    this.onHold = false,
    this.items = 0,
    this.asked = 0,
    this.offers = 0,
    this.quoteTotal,
    this.quoteCurrency,
    this.createdAt,
  });

  factory InquiryRow.fromJson(Json j) => InquiryRow(
    id: j.str('id'),
    refNo: j.str('refNo'),
    title: j.strOrNull('title'),
    category: j.strOrNull('category'),
    stage: j.strOrNull('stage'),
    priority: j.str('priority', 'normal'),
    customer: j.at('customer.name'),
    assignee: j.at('assignee.name'),
    requiredBy: j.strOrNull('requiredBy'),
    overdue: j.boolean('overdue'),
    onHold: j.boolean('onHold'),
    items: j.integer('items'),
    asked: j.integer('asked'),
    offers: j.integer('offers'),
    quoteTotal: j.at('quotation.latest.total'),
    quoteCurrency: j.at('quotation.latest.currency'),
    createdAt: j.date('createdAt'),
  );

  final String id, refNo, priority;
  final String? title, category, stage, customer, assignee, requiredBy, quoteTotal, quoteCurrency;
  final bool overdue, onHold;
  final int items, asked, offers;
  final DateTime? createdAt;

  /// What it is about: the title, else the category.
  String get what => title ?? category ?? refNo;
}

/// The list's filter: one chip at a time, plus words to search for.
class InquiryFilter {
  const InquiryFilter({this.stage = 'open', this.q = '', this.mine = false});
  final String stage, q;
  final bool mine;

  InquiryFilter copyWith({String? stage, String? q, bool? mine}) =>
      InquiryFilter(stage: stage ?? this.stage, q: q ?? this.q, mine: mine ?? this.mine);

  @override
  bool operator ==(Object other) =>
      other is InquiryFilter && other.stage == stage && other.q == q && other.mine == mine;
  @override
  int get hashCode => Object.hash(stage, q, mine);
}

class InquiryPage {
  const InquiryPage(this.rows, {required this.total, required this.counts});
  final List<InquiryRow> rows;
  final int total;
  final Map<String, int> counts;
}

/// The first page for a filter (50 rows; the list asks for more as you scroll).
final inquiriesProvider = FutureProvider.autoDispose.family<InquiryPage, InquiryFilter>((ref, f) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return fetchInquiries(api, f, 1);
});

Future<InquiryPage> fetchInquiries(Api api, InquiryFilter f, int page) async {
  final j = await api.get(
    '/api/inquiries',
    query: {
      'stage': f.stage,
      if (f.q.trim().isNotEmpty) 'q': f.q.trim(),
      if (f.mine) 'assignee': 'me',
      'page': page,
      'pageSize': 50,
    },
  );
  final counts = <String, int>{
    for (final e in (j['counts'] as Map<String, dynamic>? ?? const {}).entries)
      if (e.value is num) e.key: (e.value as num).toInt(),
  };
  return InquiryPage(j.list('rows', InquiryRow.fromJson), total: j.integer('total'), counts: counts);
}

/// One requested line.
class Item {
  const Item({
    required this.id,
    this.no,
    required this.description,
    this.model,
    required this.quantity,
    required this.unit,
    this.targetPrice,
    this.parentId,
  });
  factory Item.fromJson(Json j) => Item(
    id: j.str('id'),
    no: j.strOrNull('no'),
    description: j.str('description'),
    model: j.strOrNull('model'),
    quantity: j.str('quantity'),
    unit: j.str('unit', 'pcs'),
    targetPrice: j.strOrNull('targetPrice'),
    parentId: j.strOrNull('parentId'),
  );
  final String id, description, quantity, unit;
  final String? no, model, targetPrice, parentId;
}

class InquiryNote {
  const InquiryNote({required this.body, this.at, this.author});
  factory InquiryNote.fromJson(Json j) =>
      InquiryNote(body: j.str('body'), at: j.date('createdAt'), author: j.at('author.name'));
  final String body;
  final DateTime? at;
  final String? author;
}

/// A deal, as its page shows it.
class Inquiry {
  const Inquiry(this.j);
  final Json j;

  String get id => j.str('id');
  String get refNo => j.str('refNo');
  String? get title => j.strOrNull('title');
  String? get category => j.strOrNull('category');
  String get what => title ?? category ?? refNo;
  String? get requirements => j.strOrNull('requirements');
  String? get stage => j.strOrNull('stage');
  String get priority => j.str('priority', 'normal');
  String get channel => j.str('channel', 'email');
  String? get requiredBy => j.strOrNull('requiredBy');
  bool get onHold => j.boolean('onHold');
  bool get overdue => j.boolean('overdue');
  String? get lostReason => j.strOrNull('lostReason');
  String? get lostNote => j.strOrNull('lostNote');
  String? get customerId => j.strOrNull('customerId');
  String? get customer => j.at('customer.name');
  String? get country => j.at('customer.country');
  String? get contact => j.at('contact.name');
  String? get contactPhone => j.at('contact.phone') ?? j.at('contact.mobile');
  String? get contactEmail => j.at('contact.email');
  String? get assignee => j.at('assignee.name');
  DateTime? get createdAt => j.date('createdAt');
  DateTime? get updatedAt => j.date('updatedAt');
  List<Item> get items => j.list('items', Item.fromJson);
  List<InquiryNote> get notes => j.list('notes', InquiryNote.fromJson);
  String? get quoteRef => j.at('quotation.refNo');
  String? get quoteTotal => j.at('quotation.latest.total');
  String? get quoteCurrency => j.at('quotation.latest.currency');
  String? get quoteStatus => j.at('quotation.latest.status');
  String? get orderId => j.at('orders.0.id');
  String? get orderRef => j.at('orders.0.refNo');
  Json? get lastChange => j.list('stageChanges', (m) => m).lastOrNull;
}

final inquiryProvider = FutureProvider.autoDispose.family<Inquiry, String>((ref, id) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return Inquiry(await api.get('/api/inquiries/$id'));
});

/// The deal's quotation: every revision, newest first. Costs only for people who may see them.
class Quotation {
  const Quotation(this.j);
  final Json j;
  String? get refNo => j.at('quotation.refNo');
  List<Json> get revisions => j.list('revisions', (m) => m);
  bool get canStart => j.boolean('canStartRevision');
  String? get whyNotStart => j.strOrNull('whyNotStart');
}

final quotationProvider = FutureProvider.autoDispose.family<Quotation, String>((ref, inquiryId) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return Quotation(await api.get('/api/inquiries/$inquiryId/quotation'));
});

/// This deal's follow-ups (open first).
final inquiryFollowUpsProvider = FutureProvider.autoDispose.family<List<Json>, String>((ref, inquiryId) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return api.getList('/api/follow-ups', query: {'inquiryId': inquiryId});
});

/// A name to choose: customers, people.
class Choice {
  const Choice(this.id, this.name, [this.detail]);
  final String id, name;
  final String? detail;
}

final customerNamesProvider = FutureProvider.autoDispose<List<Choice>>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return [
    for (final c in await api.getList('/api/customers/names'))
      Choice(c.str('id'), c.str('name'), c.strOrNull('country')),
  ];
});

final peopleProvider = FutureProvider.autoDispose<List<Choice>>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return [
    for (final p in await api.getList('/api/users/people')) Choice(p.str('id'), p.str('name'), p.strOrNull('roleName')),
  ];
});

/// The company's sales settings: categories and the base currency.
final salesSettingsProvider = FutureProvider.autoDispose<Json>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return (await api.get('/api/settings')).objAt('sales') ?? const {};
});

/// What changes a deal. Each throws [ApiException] with the server's words.
class InquiryActions {
  const InquiryActions(this.api);
  final Api api;

  Future<String> create(Json body) async => (await api.post('/api/inquiries', body)).str('id');
  Future<void> move(String id, String to, {String? lostReason, String? note}) => api.post('/api/inquiries/$id/stage', {
    'to': to,
    'lostReason': ?lostReason,
    if (note != null && note.isNotEmpty) 'note': note,
  });
  Future<void> hold(String id, bool onHold, {String? note}) =>
      api.post('/api/inquiries/$id/hold', {'onHold': onHold, if (note != null && note.isNotEmpty) 'note': note});
  Future<void> note(String id, String body) => api.post('/api/inquiries/$id/notes', {'body': body});
}
