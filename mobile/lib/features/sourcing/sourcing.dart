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
          subtitle: Text([if (s.sn('contactPerson') != null) s.s('contactPerson'), if (s.sn('phone') != null) s.s('phone'), 'VAT ${num.tryParse(s.s('defaultVatRate')) ?? 0}%'].join(' · ')),
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
                ('Usual VAT', '${num.tryParse(s.s('defaultVatRate')) ?? 0}%'),
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
          _f[k]!.text = k == 'defaultVatRate' ? (num.tryParse(s.s(k)) ?? 13).toString() : s.s(k);
        }
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
    final body = {for (final k in _keys) k: _f[k]!.text};
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
                  field('defaultVatRate', 'Usual VAT on their prices (%)', optional: false, kb: const TextInputType.numberWithOptions(decimal: true), helper: 'New offer lines start with this; each line can differ'),
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
  final factories = (await ref.read(apiProvider).get('/api/v1/factories')).l('rows');
  if (!context.mounted) return;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _PriceSheet(queryId: queryId, item: item, currency: currency, factories: factories),
  );
}

class _PriceSheet extends ConsumerStatefulWidget {
  const _PriceSheet({required this.queryId, required this.item, required this.currency, required this.factories});
  final String queryId;
  final Json item;
  final String currency;
  final List<Json> factories;
  @override
  ConsumerState<_PriceSheet> createState() => _PriceSheetState();
}

class _PriceSheetState extends ConsumerState<_PriceSheet> {
  late final Json? _c = widget.item.mn('chosen');
  late final _name = TextEditingController(text: _c?.s('supplierName') ?? '');
  late final _price = TextEditingController(text: _c == null ? '' : (num.tryParse(_c.s('unitPrice')) ?? 0).toString());
  late final _vat = TextEditingController(text: _c == null ? '13' : (num.tryParse(_c.s('vatRate')) ?? 13).toString());
  late final _lead = TextEditingController(text: _c?.s('leadTime') ?? '');
  final _email = TextEditingController();
  final _phone = TextEditingController();
  late bool _incl = _c?.b('pricesIncludeVat', true) ?? true;
  ApiException? _error;

  String get _path => '/api/v1/inquiries/${widget.queryId}/items/${widget.item.s('id')}/factory-price';

  Json? get _known {
    final n = _name.text.trim().toLowerCase();
    for (final f in widget.factories) {
      if (f.s('name').toLowerCase() == n) return f;
    }
    return null;
  }

  bool get _isNew => _name.text.trim().length >= 2 && _known == null;

  @override
  void dispose() {
    for (final c in [_name, _price, _vat, _lead, _email, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _error = null);
    try {
      await ref.mutate(() => ref.read(apiProvider).put(_path, {
            'factoryName': _name.text,
            'unitPrice': _price.text,
            'vatRate': _vat.text,
            'pricesIncludeVat': _incl,
            'leadTime': _lead.text,
            if (_isNew) 'email': _email.text,
            if (_isNew) 'phone': _phone.text,
          }));
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

  @override
  Widget build(BuildContext context) {
    final e = _error;
    final unit = widget.item.s('unit', 'unit');
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Factory price', style: context.t.titleLarge),
          Text('${_name0(widget.item)} · ${f.qty(widget.item['quantity'])} $unit', style: context.t.bodySmall),
          gap16,
          Autocomplete<String>(
            initialValue: TextEditingValue(text: _name.text),
            optionsBuilder: (v) {
              final q = v.text.trim().toLowerCase();
              if (q.isEmpty) return const Iterable<String>.empty();
              return widget.factories.map((f) => f.s('name')).where((n) => n.toLowerCase().contains(q)).take(6);
            },
            onSelected: (v) => setState(() {
              _name.text = v;
              final k = _known;
              if (k != null && _c == null) _vat.text = (num.tryParse(k.s('defaultVatRate')) ?? 13).toString();
            }),
            fieldViewBuilder: (context, controller, focus, onSubmit) => Field(
              label: 'Factory',
              controller: controller,
              error: e?.field('factoryName'),
              helper: _isNew ? 'New factory: it is added for you' : 'Start typing to pick one you have used before',
              onChanged: (v) => setState(() => _name.text = v),
            ),
          ),
          if (_isNew) ...[
            Field(label: 'Factory email', controller: _email, optional: true, keyboard: TextInputType.emailAddress, error: e?.field('email')),
            Field(label: 'Phone / WeChat', controller: _phone, optional: true, keyboard: TextInputType.phone, error: e?.field('phone')),
          ],
          Field(label: 'Price for 1 $unit (${widget.currency})', controller: _price, keyboard: const TextInputType.numberWithOptions(decimal: true), error: e?.field('unitPrice')),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 110, child: Field(label: 'VAT %', controller: _vat, keyboard: const TextInputType.numberWithOptions(decimal: true), error: e?.field('vatRate'))),
            gap12,
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 18),
                child: CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: const Text('The price includes VAT'),
                  value: _incl,
                  onChanged: (v) => setState(() => _incl = v ?? true),
                ),
              ),
            ),
          ]),
          Field(label: 'Lead time', controller: _lead, optional: true, hint: 'e.g. 45 days after deposit', error: e?.field('leadTime')),
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
