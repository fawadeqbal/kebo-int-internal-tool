import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../../ui/paged.dart';

/// The item's name: the first line of its description.
String _name(String description) => description.split('\n').first;


/* ---------------------------------------------------------------- Factories */

class FactoriesScreen extends ConsumerStatefulWidget {
  const FactoriesScreen({super.key});
  @override
  ConsumerState<FactoriesScreen> createState() => _FactoriesScreenState();
}

class _FactoriesScreenState extends ConsumerState<FactoriesScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final api = ref.read(apiProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Factories')),
      floatingActionButton: FloatingActionButton(onPressed: () => context.push('/factories/new'), tooltip: 'Add factory', child: const Icon(Icons.add_business_outlined)),
      body: PagedList(
        key: ValueKey('$version|$_q'),
        load: (page) => api.get('/api/v1/factories', query: {'q': _q, 'page': page}),
        header: [
          SearchBox(hint: 'Search name, contact, phone, WeChat…', initial: _q, onChanged: (v) => setState(() => _q = v)),
          const Padding(padding: EdgeInsets.fromLTRB(16, 10, 16, 0), child: Text('The factories you buy from. Internal: never shown to customers.')),
          gap12,
        ],
        empty: const EmptyState(icon: Icons.factory_outlined, title: 'No factories yet', message: 'Add one here, or just type its name when you add a factory price on an inquiry.'),
        itemBuilder: (context, s) => RowTile(
          leading: Icon(Icons.factory_outlined, color: context.c.primary),
          title: s.s('name'),
          subtitle: Text([if (s.sn('contactPerson') != null) s.s('contactPerson'), if (s.sn('phone') != null) s.s('phone'), 'VAT ${_plain(_num(s['defaultVatRate'], 13))}% ${s.b('pricesIncludeVat', true) ? 'incl.' : '+ on top'}'].join(' · ')),
          trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('${s.i('offers')}', style: context.t.titleSmall),
            Text(s.i('offers') == 1 ? 'inquiry' : 'inquiries', style: context.t.bodySmall),
          ]),
          onTap: () => context.push('/factories/${s.s('id')}'),
        ),
      ),
    );
  }
}

class FactoryDetailScreen extends ConsumerWidget {
  const FactoryDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final path = '/api/v1/factories/$id';
    final data = ref.watch(getProvider(path));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(getProvider(path)))),
      data: (d) {
        final s = d.m('supplier');
        final digits = s.s('phone').replaceAll(RegExp(r'\D'), '');
        return Scaffold(
          appBar: AppBar(
            title: const Text('Factory'),
            actions: [
              IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/factories/$id/edit')),
              if (d.m('can').b('delete'))
                PopupMenuButton<String>(
                  onSelected: (_) async {
                    if (!await confirm(context, title: 'Remove this factory?', message: 'It leaves the lists and pickers. Its past offers stay on their inquiries.', action: 'Remove', danger: true)) return;
                    try {
                      await ref.mutate(() => ref.read(apiProvider).delete(path));
                      if (context.mounted) {
                        toast(context, 'Factory removed');
                        context.pop();
                      }
                    } catch (e) {
                      if (context.mounted) toast(context, e.toString(), error: true);
                    }
                  },
                  itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('Remove factory'))],
                ),
            ],
          ),
          body: ListView(padding: pagePadding, children: [
            Text(s.s('name'), style: context.t.titleLarge),
            if (s.sn('contactPerson') != null) Text(s.s('contactPerson'), style: context.t.bodySmall),
            gap16,
            if (s.sn('phone') != null) ...[
              ContactButtons(
                phone: s.s('phone'),
                email: s.sn('email'),
                onCall: () => launchUrl(Uri.parse('tel:${s.s('phone')}')),
                onWhatsApp: () => launchUrl(Uri.parse('https://wa.me/$digits'), mode: LaunchMode.externalApplication),
                onEmail: () => launchUrl(Uri.parse('mailto:${s.s('email')}')),
              ),
              gap16,
            ],
            SectionCard(
              title: 'Details',
              child: kv([
                ('Phone', s.s('phone', '—')),
                ('WeChat', s.s('wechat', '—')),
                ('Email', s.s('email', '—')),
                ('Address', s.s('address', '—')),
                ('VAT', _vatText(_num(s['defaultVatRate'], 13), s.b('pricesIncludeVat', true)).substring(4)),
              ]),
            ),
            if (s.sn('bankDetails') != null) SectionCard(title: 'Bank details', child: SelectableText(s.s('bankDetails'), style: context.t.bodyMedium)),
            if (s.sn('notes') != null) SectionCard(title: 'Notes', child: Text(s.s('notes'), style: context.t.bodyMedium!.copyWith(color: context.c.text2))),
            SectionCard(
              title: 'Prices on inquiries',
              subtitle: 'What they charge, per item (internal)',
              padding: EdgeInsets.zero,
              child: d.l('offers').isEmpty
                  ? Padding(padding: const EdgeInsets.all(16), child: Text('None yet. Add one on an inquiry: Factory prices → Add price.', style: context.t.bodySmall))
                  : CardList(children: [
                      for (final o in d.l('offers'))
                        RowTile(
                          title: _name(o.s('description')),
                          subtitle: Text('${o.s('queryRef')} · ${o.s('queryTitle')}'),
                          trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text(f.money(o['unitPrice'], o.s('currency', 'USD')), style: context.t.titleSmall),
                            Text('${o.b('pricesIncludeVat') ? 'incl.' : '+'} ${num.tryParse(o.s('vatRate')) ?? 0}% VAT', style: context.t.bodySmall),
                          ]),
                          onTap: () => context.push('/inquiries/${o.s('queryId')}'),
                        ),
                    ]),
            ),
          ]),
        );
      },
    );
  }
}

class FactoryFormScreen extends ConsumerStatefulWidget {
  const FactoryFormScreen({super.key, this.editId});
  final String? editId;
  @override
  ConsumerState<FactoryFormScreen> createState() => _FactoryFormScreenState();
}

class _FactoryFormScreenState extends ConsumerState<FactoryFormScreen> {
  static const _keys = ['name', 'contactPerson', 'phone', 'wechat', 'email', 'address', 'defaultVatRate', 'bankDetails', 'notes'];
  final _f = {for (final k in _keys) k: TextEditingController(text: k == 'defaultVatRate' ? '13' : '')};
  bool _loaded = false;
  bool _incl = true;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    if (widget.editId == null) {
      _loaded = true;
    } else {
      ref.read(apiProvider).get('/api/v1/factories/${widget.editId}').then((d) {
        final s = d.m('supplier');
        for (final k in _keys) {
          _f[k]!.text = k == 'defaultVatRate' ? _plain(num.tryParse(s.s(k)) ?? 13) : s.s(k);
        }
        _incl = s.b('pricesIncludeVat', true);
        if (mounted) setState(() => _loaded = true);
      });
    }
  }

  @override
  void dispose() {
    for (final c in _f.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _error = null);
    final api = ref.read(apiProvider);
    final body = <String, Object?>{for (final k in _keys) k: _f[k]!.text, 'pricesIncludeVat': _incl};
    try {
      if (widget.editId != null) {
        await ref.mutate(() => api.patch('/api/v1/factories/${widget.editId}', body));
        if (mounted) {
          toast(context, 'Factory saved');
          context.pop();
        }
      } else {
        final res = await ref.mutate(() => api.post('/api/v1/factories', body));
        if (mounted) {
          toast(context, 'Factory added');
          context.pushReplacement('/factories/${res.s('id')}');
        }
      }
    } on ApiException catch (e) {
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _error;
    Field field(String k, String label, {bool optional = true, int lines = 1, TextInputType? kb, String? helper}) =>
        Field(label: label, controller: _f[k]!, optional: optional, maxLines: lines, keyboard: kb, helper: helper, error: e?.field(k));
    return Scaffold(
      appBar: AppBar(title: Text(widget.editId == null ? 'Add factory' : 'Edit factory')),
      body: !_loaded
          ? const LoadingView()
          : ListView(padding: pagePadding, children: [
              SectionCard(
                child: Column(children: [
                  field('name', 'Factory name', optional: false),
                  field('contactPerson', 'Contact person'),
                  field('phone', 'Phone', kb: TextInputType.phone),
                  field('wechat', 'WeChat'),
                  field('email', 'Email', kb: TextInputType.emailAddress),
                  field('defaultVatRate', 'Their VAT (%)', optional: false, kb: const TextInputType.numberWithOptions(decimal: true), helper: 'Their prices start with this; an item can differ (e.g. 6% on a service)'),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: const Text('Their prices include VAT'),
                    value: _incl,
                    onChanged: (v) => setState(() => _incl = v ?? true),
                  ),
                  field('address', 'Address', lines: 2),
                  field('bankDetails', 'Bank details', lines: 3),
                  field('notes', 'Notes', lines: 3, helper: 'Quality, reliability, what they are good at'),
                ]),
              ),
              BusyButton(label: widget.editId == null ? 'Add factory' : 'Save factory', onPressed: _save),
            ]),
    );
  }
}

/* ---------------------------------------------------------------- Factory prices on an inquiry */

/// Per customer item: which factory supplies it and at what price (USD). One
/// price per item, typed straight in; new quotations are priced from these.
class FactoryPricesCard extends ConsumerWidget {
  const FactoryPricesCard({super.key, required this.queryId});
  final String queryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(sessionProvider).can('sourcing.manage')) return const SizedBox.shrink();
    final d = ref.watch(getProvider('/api/v1/inquiries/$queryId/sourcing')).value;
    if (d == null) return const SizedBox.shrink();
    final items = d.l('items');
    final cur = d.s('currency', 'USD');
    final edit = d.m('can').b('edit');
    final priced = items.where((it) => it.mn('chosen') != null).length;
    return SectionCard(
      title: 'Factory prices',
      subtitle: '$priced of ${items.length} ${items.length == 1 ? 'item' : 'items'} priced · internal, never shown to the customer',
      padding: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        CardList(children: [
          for (var n = 0; n < items.length; n++)
            Builder(builder: (context) {
              final it = items[n];
              final c = it.mn('chosen');
              return RowTile(
                title: '${n + 1}. ${_name(it.s('description'))}',
                subtitle: Text(c == null
                    ? 'No factory price yet'
                    : '${c.s('supplierName')} · ${f.money(c['unitPrice'], cur)} ${c.b('pricesIncludeVat') ? 'incl.' : '+'} ${num.tryParse(c.s('vatRate')) ?? 0}% VAT'),
                trailing: c == null
                    ? (edit ? const ToneBadge('Add price', tone: Tone.info) : null)
                    : Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(f.money(c['unitCost'] ?? c['unitPriceWithVat'], cur), style: context.t.titleSmall),
                        Text('our cost', style: context.t.bodySmall),
                      ]),
                onTap: edit ? () => _openPriceSheet(context, ref, queryId, it, cur) : null,
              );
            }),
        ]),
        if (priced > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Text('New quotations are priced from these: our cost (VAT included) plus ${d.n('defaultMarginPercent')}% margin.', style: context.t.bodySmall),
          ),
      ]),
    );
  }
}

Future<void> _openPriceSheet(BuildContext context, WidgetRef ref, String queryId, Json item, String currency) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _PriceSheet(queryId: queryId, item: item, currency: currency),
  );
}

String _vatText(num rate, bool incl) => 'VAT ${_plain(rate)}%, ${incl ? 'included in their prices' : 'added on top'}';
/// A number as typed in a box: no thousands separators, no trailing .0.
String _plain(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();
num _num(Object? v, [num fallback = 0]) => v is num ? v : num.tryParse('${v ?? ''}') ?? fallback;

/// What the factory search returned: a factory we already have, or a new name
/// (with [edit] when its email, phone and VAT should be asked as well).
class _Pick {
  const _Pick.existing(Json this.factory)
      : name = null,
        edit = false;
  const _Pick.create(String this.name, {this.edit = false}) : factory = null;
  final Json? factory;
  final String? name;
  final bool edit;
  bool get isNew => factory == null;
  String get label => factory?.s('name') ?? name!;
}

String _contacts(Json r) => [
      for (final k in ['contactPerson', 'phone', 'email', 'wechat'])
        if (r.sn(k) != null) r.s(k),
    ].join(' · ');

/// The standard supplier search: recently used factories first, typing finds
/// them by name, email, phone, WeChat or contact, and the list ends with
/// Create "…" and Create and edit… for a factory we do not have yet.
class _FactorySearchScreen extends ConsumerStatefulWidget {
  const _FactorySearchScreen();
  @override
  ConsumerState<_FactorySearchScreen> createState() => _FactorySearchScreenState();
}

class _FactorySearchScreenState extends ConsumerState<_FactorySearchScreen> {
  final _q = TextEditingController();
  Timer? _debounce;
  List<Json> _rows = const [];
  bool _loading = true;
  String _for = '';
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final q = _q.text.trim();
    final seq = ++_seq;
    setState(() => _loading = true);
    try {
      final d = await ref.read(apiProvider).get('/api/v1/factories/search', query: {'q': q});
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = d.l('rows');
        _for = q;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() => _loading = false);
      toast(context, e.toString(), error: true);
    }
  }

  void _changed(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 220), _load);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final typed = _q.text.trim();
    final exact = _rows.any((r) => r.s('name').toLowerCase() == typed.toLowerCase());
    final canCreate = typed.length >= 2 && !exact;
    return Scaffold(
      appBar: AppBar(title: const Text('Choose factory')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            controller: _q,
            autofocus: true,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search factories, or type a new name',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: typed.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear',
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () {
                        _q.clear();
                        _changed('');
                      }),
            ),
            onChanged: _changed,
            onSubmitted: (_) {
              if (_rows.isNotEmpty && _for == typed && typed.isNotEmpty) {
                Navigator.pop(context, _Pick.existing(_rows.first));
              } else if (canCreate) {
                Navigator.pop(context, _Pick.create(typed));
              }
            },
          ),
        ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        Expanded(
          child: ListView(children: [
            if (typed.isEmpty && _rows.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Text('RECENTLY USED', style: context.t.labelSmall!.copyWith(color: context.c.text2, letterSpacing: .6)),
              ),
            for (final r in _rows)
              ListTile(
                leading: Icon(Icons.factory_outlined, color: context.c.primary),
                title: Text(r.s('name')),
                subtitle: Text([if (_contacts(r).isNotEmpty) _contacts(r), _vatText(_num(r['defaultVatRate'], 13), r.b('pricesIncludeVat', true))].join('\n')),
                isThreeLine: _contacts(r).isNotEmpty,
                onTap: () => Navigator.pop(context, _Pick.existing(r)),
              ),
            if (!_loading && _rows.isEmpty && typed.isNotEmpty)
              Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 4), child: Text('No factory matches “$typed”.', style: context.t.bodySmall)),
            if (!_loading && _rows.isEmpty && typed.isEmpty)
              Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 4), child: Text('No factories yet. Type the name of the factory to add it.', style: context.t.bodySmall)),
            if (canCreate) ...[
              const Divider(height: 1),
              ListTile(
                leading: Icon(Icons.add_rounded, color: context.c.primary),
                title: Text('Create “$typed”'),
                subtitle: const Text('Just the name'),
                onTap: () => Navigator.pop(context, _Pick.create(typed)),
              ),
              ListTile(
                leading: Icon(Icons.edit_outlined, color: context.c.primary),
                title: const Text('Create and edit…'),
                subtitle: const Text('Add email, phone, VAT'),
                onTap: () => Navigator.pop(context, _Pick.create(typed, edit: true)),
              ),
            ],
          ]),
        ),
      ]),
    );
  }
}

class _PriceSheet extends ConsumerStatefulWidget {
  const _PriceSheet({required this.queryId, required this.item, required this.currency});
  final String queryId;
  final Json item;
  final String currency;
  @override
  ConsumerState<_PriceSheet> createState() => _PriceSheetState();
}

class _PriceSheetState extends ConsumerState<_PriceSheet> {
  late final Json? _c = widget.item.mn('chosen');
  late final _price = TextEditingController(text: _c == null ? '' : _plain(_num(_c['unitPrice'])));
  late final _lead = TextEditingController(text: _c?.s('leadTime') ?? '');
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _factoryVat = TextEditingController(text: '13');
  bool _factoryIncl = true;
  late final _itemVat = TextEditingController(text: _c == null ? '' : _plain(_num(_c['vatRate'])));
  late bool _itemIncl = _c?.b('pricesIncludeVat', true) ?? true;
  _Pick? _pick;
  bool _differs = false;
  ApiException? _error;

  String get _path => '/api/v1/inquiries/${widget.queryId}/items/${widget.item.s('id')}/factory-price';

  @override
  void initState() {
    super.initState();
    final c = _c;
    if (c != null && c.sn('supplierId') != null) {
      _pick = _Pick.existing({
        'id': c.s('supplierId'),
        'name': c.s('supplierName'),
        'email': c['supplierEmail'],
        'phone': c['supplierPhone'],
        'defaultVatRate': c['supplierVatRate'],
        'pricesIncludeVat': c['supplierPricesIncludeVat'],
      });
      final fv = _factoryVatOf(_pick!);
      _differs = _num(c['vatRate']) != fv.$1 || c.b('pricesIncludeVat', true) != fv.$2;
    }
  }

  /// The factory's own VAT: from the factory, or what is typed for a new one.
  (num, bool) _factoryVatOf(_Pick p) =>
      p.isNew ? (_num(_factoryVat.text, 13), _factoryIncl) : (_num(p.factory!['defaultVatRate'], 13), p.factory!.b('pricesIncludeVat', true));

  @override
  void dispose() {
    for (final c in [_price, _lead, _email, _phone, _factoryVat, _itemVat]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _choose() async {
    final p = await Navigator.of(context).push<_Pick>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => const _FactorySearchScreen()));
    if (p == null || !mounted) return;
    setState(() {
      _pick = p;
      _differs = false;
      _error = null;
    });
  }

  Future<void> _save() async {
    setState(() => _error = null);
    final p = _pick;
    if (p == null) {
      setState(() => _error = ApiException('Choose the factory', status: 422, fieldErrors: const {'factoryName': 'Choose the factory, or type a new one\'s name'}));
      return;
    }
    final body = <String, Object?>{
      if (p.isNew) 'factoryName': p.name else 'supplierId': p.factory!.s('id'),
      'unitPrice': _price.text,
      'leadTime': _lead.text,
      if (p.isNew && p.edit) ...{'email': _email.text, 'phone': _phone.text, 'vatRate': _factoryVat.text, 'pricesIncludeVat': _factoryIncl},
      if (_differs) ...{'vatRate': _itemVat.text, 'pricesIncludeVat': _itemIncl},
    };
    try {
      await ref.mutate(() => ref.read(apiProvider).put(_path, body));
      if (mounted) {
        toast(context, 'Factory price saved');
        Navigator.pop(context);
      }
    } on ApiException catch (e) {
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _remove() async {
    try {
      await ref.mutate(() => ref.read(apiProvider).delete(_path));
      if (mounted) {
        toast(context, 'Factory price removed');
        Navigator.pop(context);
      }
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Widget _factoryBox(BuildContext context) {
    final p = _pick;
    final err = _error?.field('factoryName') ?? _error?.field('supplierId');
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const FieldLabel('Factory'),
        Material(
          color: context.c.surface,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: err != null ? context.c.bad : context.c.line)),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: _choose,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
              child: Row(children: [
                Icon(Icons.factory_outlined, color: p == null ? context.c.text2 : context.c.primary),
                gap12,
                Expanded(
                  child: p == null
                      ? Text('Search or add a factory', style: context.t.bodyMedium!.copyWith(color: context.c.text2))
                      : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(p.label, style: context.t.titleSmall),
                          const SizedBox(height: 4),
                          ToneBadge(p.isNew ? 'New factory' : 'Existing factory', tone: p.isNew ? Tone.info : Tone.ok),
                        ]),
                ),
                Text(p == null ? 'Choose' : 'Change', style: context.t.labelLarge!.copyWith(color: context.c.primary)),
                Icon(Icons.chevron_right_rounded, color: context.c.text2),
              ]),
            ),
          ),
        ),
        if (err != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(err, style: context.t.bodySmall!.copyWith(color: context.c.bad))),
        if (p != null && p.isNew && !p.edit)
          Padding(padding: const EdgeInsets.only(top: 6), child: Text('It is added to your factories when you save.', style: context.t.bodySmall)),
      ]),
    );
  }

  Widget _check(String label, bool value, ValueChanged<bool> onChanged) => CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        dense: true,
        controlAffinity: ListTileControlAffinity.leading,
        title: Text(label),
        value: value,
        onChanged: (v) => setState(() => onChanged(v ?? true)),
      );

  @override
  Widget build(BuildContext context) {
    final e = _error;
    final unit = widget.item.s('unit', 'unit');
    final p = _pick;
    final fv = p == null ? null : _factoryVatOf(p);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Factory price', style: context.t.titleLarge),
          Text('${_name0(widget.item)} · ${f.qty(widget.item['quantity'])} $unit', style: context.t.bodySmall),
          gap16,
          _factoryBox(context),
          if (p != null && p.isNew && p.edit) ...[
            Field(label: 'Factory email', controller: _email, optional: true, keyboard: TextInputType.emailAddress, error: e?.field('email')),
            Field(label: 'Phone / WeChat', controller: _phone, optional: true, keyboard: TextInputType.phone, error: e?.field('phone')),
            Field(label: 'Their VAT %', controller: _factoryVat, keyboard: const TextInputType.numberWithOptions(decimal: true), helper: 'Used for all their prices', error: _differs ? null : e?.field('vatRate'), onChanged: (_) => setState(() {})),
            _check('Their prices include VAT', _factoryIncl, (v) => _factoryIncl = v),
            gap8,
          ],
          Field(label: 'Price for 1 $unit (${widget.currency})', controller: _price, keyboard: const TextInputType.numberWithOptions(decimal: true), error: e?.field('unitPrice')),
          Field(label: 'Lead time', controller: _lead, optional: true, hint: 'e.g. 45 days after deposit', error: e?.field('leadTime')),
          if (fv != null && !_differs)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(children: [
                Icon(Icons.receipt_long_outlined, size: 18, color: context.c.text2),
                const SizedBox(width: 8),
                Expanded(child: Text(_vatText(fv.$1, fv.$2), style: context.t.bodyMedium)),
                TextButton(
                  onPressed: () => setState(() {
                    _differs = true;
                    _itemVat.text = _plain(fv.$1);
                    _itemIncl = fv.$2;
                  }),
                  child: const Text('Different for this item'),
                ),
              ]),
            ),
          if (fv != null && _differs) ...[
            Field(label: 'VAT % for this item', controller: _itemVat, keyboard: const TextInputType.numberWithOptions(decimal: true), helper: 'e.g. 6% on a service', error: e?.field('vatRate')),
            _check('This price includes VAT', _itemIncl, (v) => _itemIncl = v),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(onPressed: () => setState(() => _differs = false), child: Text('Use the factory\'s VAT (${_plain(fv.$1)}%)')),
            ),
          ],
          gap8,
          BusyButton(label: 'Save', onPressed: _save),
          if (_c != null) ...[
            gap8,
            TextButton.icon(onPressed: _remove, icon: Icon(Icons.delete_outline_rounded, color: context.c.bad), label: Text('Remove price', style: TextStyle(color: context.c.bad))),
          ],
        ]),
      ),
    );
  }
}

String _name0(Json item) => _name(item.s('description'));
