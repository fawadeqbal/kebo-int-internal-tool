import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import '../../ui/line_items.dart';
import '../../ui/paged.dart';

/// The item's name: the first line of its description.
String _name(String description) => description.split('\n').first;

/// One unit incl. VAT, as the factory quoted it.
String _withVat(Json line) => '${f.money(line['unitPriceWithVat'], line.s('offerCurrency'))} incl. ${num.tryParse(line.s('vatRate')) ?? 0}% VAT';

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
        empty: const EmptyState(icon: Icons.factory_outlined, title: 'No factories yet', message: 'Add one here, or while recording a factory offer on an inquiry.'),
        itemBuilder: (context, s) => RowTile(
          leading: Icon(Icons.factory_outlined, color: context.c.primary),
          title: s.s('name'),
          subtitle: Text([if (s.sn('contactPerson') != null) s.s('contactPerson'), if (s.sn('phone') != null) s.s('phone'), 'VAT ${num.tryParse(s.s('defaultVatRate')) ?? 0}%'].join(' · ')),
          trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('${s.i('offers')}', style: context.t.titleSmall),
            Text(s.i('offers') == 1 ? 'offer' : 'offers', style: context.t.bodySmall),
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
              title: 'Offers (${d.l('offers').length})',
              padding: EdgeInsets.zero,
              child: d.l('offers').isEmpty
                  ? Padding(padding: const EdgeInsets.all(16), child: Text('No offers recorded yet.', style: context.t.bodySmall))
                  : CardList(children: [
                      for (final o in d.l('offers'))
                        RowTile(
                          title: o.s('queryTitle'),
                          subtitle: Text('${o.s('queryRef')} · ${f.date(o.s('quotedOn'))} · ${o.i('lines')} ${o.i('lines') == 1 ? 'line' : 'lines'} · ${o.s('currency')}'),
                          onTap: () => context.push('/inquiries/${o.s('queryId')}/sourcing'),
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

/* ---------------------------------------------------------------- Inquiry card */

/// On the inquiry: which factory each item is quoted from, with Add offer / Compare & choose.
class FactoryOffersCard extends ConsumerWidget {
  const FactoryOffersCard({super.key, required this.queryId});
  final String queryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(sessionProvider).can('sourcing.manage')) return const SizedBox.shrink();
    final data = ref.watch(getProvider('/api/v1/inquiries/$queryId/sourcing'));
    final d = data.value;
    if (d == null) return const SizedBox.shrink();
    final offers = d.l('offers');
    final cur = d.s('currency', 'USD');
    final factories = offers.map((o) => o.s('supplierId')).toSet().length;
    return SectionCard(
      title: 'Factory offers',
      subtitle: offers.isEmpty ? 'Internal: what factories quote you. Never shown to the customer.' : '${offers.length} from $factories ${factories == 1 ? 'factory' : 'factories'} · internal',
      padding: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (offers.isNotEmpty)
          CardList(children: [
            for (final it in d.l('items'))
              RowTile(
                title: _name(it.s('description')),
                subtitle: it.mn('chosen') == null
                    ? null
                    : Text('${it.m('chosen').s('supplierName')}${it.l('options').length > 1 ? ' · ${it.l('options').length} offers' : ''}'),
                trailing: it.mn('chosen') == null
                    ? ToneBadge(it.l('options').isEmpty ? 'No offer yet' : 'Not chosen', tone: it.l('options').isEmpty ? Tone.neutral : Tone.warn)
                    : Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(it.m('chosen')['unitCost'] == null ? 'No rate' : f.money(it.m('chosen')['unitCost'], cur), style: context.t.titleSmall),
                        Text('cost / ${it.m('chosen').s('unit')}', style: context.t.bodySmall),
                      ]),
                onTap: () => context.push('/inquiries/$queryId/sourcing'),
              ),
          ]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: Row(children: [
            if (d.m('can').b('edit'))
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => context.push('/inquiries/$queryId/offers/new'),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Add offer'),
                ),
              ),
            if (offers.isNotEmpty) ...[
              gap8,
              Expanded(child: FilledButton.tonal(onPressed: () => context.push('/inquiries/$queryId/sourcing'), child: const Text('Compare & choose'))),
            ],
          ]),
        ),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Compare & choose */

class SourcingScreen extends ConsumerStatefulWidget {
  const SourcingScreen({super.key, required this.queryId});
  final String queryId;
  @override
  ConsumerState<SourcingScreen> createState() => _SourcingScreenState();
}

class _SourcingScreenState extends ConsumerState<SourcingScreen> {
  /// Item id → chosen offer line id ('' = price by hand). Null until loaded.
  Map<String, String>? _choices;
  Map<String, String> _saved = {};

  String get _path => '/api/v1/inquiries/${widget.queryId}/sourcing';

  Future<void> _save() async {
    await ref.mutate(() => ref.read(apiProvider).post(_path, {'choices': _choices}));
    _saved = Map.of(_choices!);
    if (mounted) toast(context, 'Saved. New quotations are priced from these offers.');
  }

  @override
  Widget build(BuildContext context) {
    final data = ref.watch(getProvider(_path));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(title: const Text('Factory offers')), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(title: const Text('Factory offers')), body: ErrorState(e, onRetry: () => ref.invalidate(getProvider(_path)))),
      data: (d) {
        final items = d.l('items');
        final fromServer = {for (final it in items) it.s('id'): it.s('chosenOfferItemId')};
        if (_choices == null || !_sameChoices(_saved, fromServer)) {
          _saved = fromServer;
          _choices = Map.of(fromServer);
        }
        final choices = _choices!;
        final edit = d.m('can').b('edit');
        final cur = d.s('currency', 'USD');
        final offers = d.l('offers');
        final changed = !_sameChoices(choices, _saved);
        final s = ref.watch(sessionProvider);
        return Scaffold(
          appBar: AppBar(title: const Text('Factory offers'), actions: [
            if (edit) IconButton(tooltip: 'Add factory offer', icon: const Icon(Icons.add_rounded), onPressed: () => context.push('/inquiries/${widget.queryId}/offers/new')),
          ]),
          bottomNavigationBar: !edit || !changed
              ? null
              : SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 8), child: BusyButton(label: 'Save choices', onPressed: _save))),
          floatingActionButton: changed || offers.isEmpty || !s.can('quotations.manage')
              ? null
              : FloatingActionButton.extended(
                  onPressed: () => context.push('/quotations/new?query=${widget.queryId}'),
                  icon: const Icon(Icons.request_quote_outlined),
                  label: const Text('Quote the customer'),
                ),
          body: ListView(padding: pagePadding, children: [
            Text('${d.m('query').s('refNo')} · ${d.m('query').s('title')}', style: context.t.bodySmall),
            gap12,
            if (d.ls('missingRates').isNotEmpty)
              Notice('No exchange rate for ${d.ls('missingRates').join(', ')}. Add it in Settings → Defaults so these offers can be compared and priced.', tone: Tone.warn),
            if (offers.isEmpty)
              EmptyState(
                icon: Icons.factory_outlined,
                title: 'No factory offers yet',
                message: 'Record what each factory quotes you: price, VAT and lead time. The quotation is then priced from the offer you choose.',
                action: edit ? FilledButton(onPressed: () => context.push('/inquiries/${widget.queryId}/offers/new'), child: const Text('Add factory offer')) : null,
              )
            else ...[
              Text('Cost per unit incl. VAT, in $cur. The quotation is priced from the chosen line at ${d.n('defaultMarginPercent')}% margin.', style: context.t.bodySmall),
              gap12,
              for (var n = 0; n < items.length; n++) _item(context, n, items[n], choices, edit, cur),
              Overline('Offers (${offers.length})'),
              for (final o in offers) _offer(context, o, edit),
              const SizedBox(height: 72),
            ],
          ]),
        );
      },
    );
  }

  Widget _item(BuildContext context, int n, Json it, Map<String, String> choices, bool edit, String cur) {
    final options = it.l('options');
    final cheapest = options.where((o) => o['unitCost'] != null).firstOrNull?.s('id');
    final id = it.s('id');
    void pick(String v) => setState(() => choices[id] = v);
    return SectionCard(
      title: '${n + 1}. ${_name(it.s('description'))}',
      subtitle: '${f.qty(it['quantity'])} ${it.s('unit')} · ${options.isEmpty ? 'no factory offer yet' : '${options.length} ${options.length == 1 ? 'offer' : 'offers'}'}',
      padding: EdgeInsets.zero,
      child: options.isEmpty
          ? const SizedBox(height: 4)
          : RadioGroup<String>(
              groupValue: choices[id] ?? '',
              onChanged: (v) {
                if (edit && v != null) pick(v);
              },
              child: Column(children: [
                for (final o in options)
                  InkWell(
                    onTap: edit ? () => pick(o.s('id')) : null,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(4, 6, 16, 6),
                      child: Row(children: [
                        Radio<String>(value: o.s('id'), enabled: edit),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                              Text(o.s('supplierName'), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                              if (o.s('id') == cheapest && options.length > 1) const ToneBadge('Cheapest', tone: Tone.ok),
                            ]),
                            Text(
                              [
                                if (o.sn('model') != null) o.s('model'),
                                if (o.sn('leadTime') != null) o.s('leadTime'),
                                if ((num.tryParse(o.s('quantity')) ?? 0) != (num.tryParse(it.s('quantity')) ?? 0)) 'quoted for ${f.qty(o['quantity'])} ${o.s('unit')}',
                              ].join(' · ').ifEmpty(_name(o.s('description'))),
                              style: context.t.bodySmall,
                            ),
                          ]),
                        ),
                        gap8,
                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                          Text(o['unitCost'] == null ? 'No rate' : f.money(o['unitCost'], cur), style: context.t.titleSmall),
                          Text(_withVat(o), style: context.t.bodySmall),
                        ]),
                      ]),
                    ),
                  ),
                InkWell(
                  onTap: edit ? () => pick('') : null,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(4, 2, 16, 6),
                    child: Row(children: [
                      Radio<String>(value: '', enabled: edit),
                      Text('None: price this item by hand', style: context.t.bodySmall),
                    ]),
                  ),
                ),
              ]),
            ),
    );
  }

  Widget _offer(BuildContext context, Json o, bool edit) {
    return SectionCard(
      title: o.s('supplierName'),
      subtitle: [f.date(o.s('quotedOn')), if (o.sn('reference') != null) 'Ref ${o.s('reference')}', if (o.sn('validUntil') != null) 'valid to ${f.date(o.s('validUntil'))}'].join(' · '),
      trailing: edit
          ? PopupMenuButton<String>(
              onSelected: (v) async {
                if (v == 'edit') {
                  context.push('/offers/${o.s('id')}/edit');
                  return;
                }
                if (!await confirm(context, title: 'Remove this offer?', message: 'Items quoted from it are left without a chosen factory.', action: 'Remove', danger: true)) return;
                try {
                  await ref.mutate(() => ref.read(apiProvider).delete('/api/v1/offers/${o.s('id')}'));
                  if (context.mounted) toast(context, 'Factory offer removed');
                } catch (e) {
                  if (context.mounted) toast(context, e.toString(), error: true);
                }
              },
              itemBuilder: (_) => const [PopupMenuItem(value: 'edit', child: Text('Edit offer')), PopupMenuItem(value: 'delete', child: Text('Remove offer'))],
            )
          : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final l in o.l('lines'))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(children: [
              Expanded(child: Text('${f.qty(l['quantity'])} × ${_name(l.s('description'))}', style: context.t.bodyMedium)),
              Text('${num.tryParse(l.s('vatRate')) ?? 0}% VAT', style: context.t.bodySmall),
            ]),
          ),
        Divider(height: 18, color: context.c.line),
        Row(children: [
          Text('Total incl. VAT', style: context.t.titleSmall),
          const Spacer(),
          Text(f.cents(o.i('totalWithVatCents'), o.s('currency')), style: context.t.titleSmall),
        ]),
        gap4,
        Text(
          [o.b('pricesIncludeVat') ? 'Prices included VAT' : 'VAT added to their prices', if (o.sn('priceBasis') != null) o.s('priceBasis'), if (o.sn('leadTime') != null) 'lead time ${o.s('leadTime')}', if (o.sn('paymentTerms') != null) o.s('paymentTerms')].join(' · '),
          style: context.t.bodySmall,
        ),
        if (o.sn('notes') != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(o.s('notes'), style: context.t.bodySmall)),
      ]),
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

bool _sameChoices(Map<String, String> a, Map<String, String> b) => a.length == b.length && a.entries.every((e) => b[e.key] == e.value);

/* ---------------------------------------------------------------- Offer form */

class _OfferLine {
  _OfferLine({this.id, this.sourceId, String description = '', String model = '', String quantity = '1', String unit = 'pcs', String unitPrice = '', String vatRate = '13'})
      : description = TextEditingController(text: description),
        model = TextEditingController(text: model),
        quantity = TextEditingController(text: quantity),
        unit = TextEditingController(text: unit),
        unitPrice = TextEditingController(text: unitPrice),
        vatRate = TextEditingController(text: vatRate);
  final String? id;
  String? sourceId;
  final TextEditingController description, model, quantity, unit, unitPrice, vatRate;

  Map<String, String> toJson() => {
        'id': ?id,
        'sourceId': sourceId ?? '',
        'description': description.text.trim(),
        'model': model.text.trim(),
        'quantity': quantity.text.trim(),
        'unit': unit.text.trim(),
        'unitPrice': unitPrice.text.trim(),
        'vatRate': vatRate.text.trim(),
      };
  bool get filled => description.text.trim().isNotEmpty && unitPrice.text.trim().isNotEmpty;
  void dispose() {
    for (final c in [description, model, quantity, unit, unitPrice, vatRate]) {
      c.dispose();
    }
  }
}

const _newFactory = '__new__';

/// Record (or edit) what one factory quoted for this inquiry: per-line price and VAT.
class OfferFormScreen extends ConsumerStatefulWidget {
  const OfferFormScreen({super.key, this.queryId, this.editId});
  final String? queryId;
  final String? editId;
  @override
  ConsumerState<OfferFormScreen> createState() => _OfferFormScreenState();
}

class _OfferFormScreenState extends ConsumerState<OfferFormScreen> {
  final _lines = <_OfferLine>[];
  final _c = {for (final k in ['newSupplierName', 'reference', 'currency', 'priceBasis', 'leadTime', 'paymentTerms', 'notes']) k: TextEditingController()};
  List<Json> _requested = [];
  Json? _supplier;
  bool _newSupplier = false;
  bool _inclVat = true;
  String _quotedOn = f.today();
  String _validUntil = '';
  String _queryId = '';
  bool _loaded = false;
  Object? _loadError;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final l in _lines) {
      l.dispose();
    }
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    try {
      Json? offer;
      if (widget.editId != null) {
        offer = await api.get('/api/v1/offers/${widget.editId}');
        _queryId = offer.m('offer').s('queryId');
      } else {
        _queryId = widget.queryId!;
      }
      final sourcing = await api.get('/api/v1/inquiries/$_queryId/sourcing');
      _requested = sourcing.l('items');
      if (offer != null) {
        final o = offer.m('offer');
        _supplier = offer.m('supplier');
        _inclVat = o.b('pricesIncludeVat', true);
        _quotedOn = o.s('quotedOn');
        _validUntil = o.s('validUntil');
        for (final k in ['reference', 'currency', 'priceBasis', 'leadTime', 'paymentTerms', 'notes']) {
          _c[k]!.text = o.s(k);
        }
        for (final it in offer.l('items')) {
          _lines.add(_OfferLine(
            id: it.s('id'),
            sourceId: it.sn('queryItemId'),
            description: it.s('description'),
            model: it.s('model'),
            quantity: f.qty(it['quantity']).replaceAll(',', ''),
            unit: it.s('unit'),
            unitPrice: (num.tryParse(it.s('unitPrice')) ?? 0).toString(),
            vatRate: (num.tryParse(it.s('vatRate')) ?? 0).toString(),
          ));
        }
      } else {
        _c['currency']!.text = 'CNY';
        for (final r in _requested) {
          _lines.add(_OfferLine(sourceId: r.s('id'), description: r.s('description'), quantity: f.qty(r['quantity']).replaceAll(',', ''), unit: r.s('unit')));
        }
      }
      if (_lines.isEmpty) _lines.add(_OfferLine());
      setState(() => _loaded = true);
    } catch (e) {
      setState(() => _loadError = e);
    }
  }

  Future<void> _pickFactory() async {
    final picked = await showModalBottomSheet<Json>(context: context, isScrollControlled: true, useSafeArea: true, builder: (_) => const _FactorySearchSheet());
    if (picked == null) return;
    setState(() {
      if (picked.s('id') == _newFactory) {
        _newSupplier = true;
        _supplier = null;
        _c['newSupplierName']!.text = picked.s('name');
      } else {
        _newSupplier = false;
        _supplier = picked;
        // Their usual VAT replaces the starting rate on lines nobody has priced yet.
        final vat = (num.tryParse(picked.s('defaultVatRate')) ?? 13).toString();
        for (final l in _lines) {
          if (l.unitPrice.text.trim().isEmpty) l.vatRate.text = vat;
        }
      }
    });
  }

  int get _totalCents {
    var t = 0;
    for (final l in _lines) {
      final p = num.tryParse(l.unitPrice.text) ?? 0, v = num.tryParse(l.vatRate.text) ?? 0, q = num.tryParse(l.quantity.text) ?? 0;
      final withVat = _inclVat ? p : p * (1 + v / 100);
      t += ((withVat * 100).round() * q).round();
    }
    return t;
  }

  Future<void> _save() async {
    setState(() => _error = null);
    final body = {
      if (!_newSupplier && _supplier != null) 'supplierId': _supplier!.s('id'),
      if (_newSupplier) 'newSupplierName': _c['newSupplierName']!.text,
      'reference': _c['reference']!.text,
      'quotedOn': _quotedOn,
      'validUntil': _validUntil,
      'currency': _c['currency']!.text.trim().toUpperCase(),
      'pricesIncludeVat': _inclVat,
      'priceBasis': _c['priceBasis']!.text,
      'leadTime': _c['leadTime']!.text,
      'paymentTerms': _c['paymentTerms']!.text,
      'notes': _c['notes']!.text,
      'items': [for (final l in _lines) if (l.filled) l.toJson()],
    };
    final api = ref.read(apiProvider);
    try {
      if (widget.editId != null) {
        await ref.mutate(() => api.patch('/api/v1/offers/${widget.editId}', body));
      } else {
        await ref.mutate(() => api.post('/api/v1/inquiries/$_queryId/offers', body));
      }
      if (!mounted) return;
      toast(context, 'Factory offer saved');
      if (widget.editId != null) {
        context.pop();
      } else {
        context.pushReplacement('/inquiries/$_queryId/sourcing');
      }
    } on ApiException catch (e) {
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.editId == null ? 'Add factory offer' : 'Edit factory offer';
    if (_loadError != null) return Scaffold(appBar: AppBar(title: Text(title)), body: ErrorState(_loadError!, onRetry: _load));
    if (!_loaded) return Scaffold(appBar: AppBar(title: Text(title)), body: const LoadingView());
    final e = _error;
    final cur = _c['currency']!.text.trim().isEmpty ? 'CNY' : _c['currency']!.text.trim().toUpperCase();
    final linesError = e?.field('items') ?? (e?.fieldErrors.keys.any((k) => k.startsWith('items')) == true ? 'Check the prices: each line needs a description and a price.' : null);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(padding: pagePadding, children: [
        if (e != null && e.fieldErrors.isNotEmpty) const Notice('Please fix the highlighted fields.', tone: Tone.bad),
        SectionCard(
          title: 'Factory',
          subtitle: 'Internal: never shown to the customer',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const FieldLabel('Factory'),
            InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: _pickFactory,
              child: InputDecorator(
                decoration: InputDecoration(errorText: e?.field('supplierId'), prefixIcon: const Icon(Icons.factory_outlined, size: 20), suffixIcon: const Icon(Icons.expand_more_rounded)),
                child: Text(
                  _newSupplier ? 'New factory' : (_supplier?.s('name') ?? 'Choose a factory, or add a new one'),
                  style: _supplier == null && !_newSupplier ? TextStyle(color: context.c.muted) : context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
            ),
            gap12,
            if (_newSupplier)
              Field(label: "New factory's name", controller: _c['newSupplierName']!, error: e?.field('newSupplierName'), helper: 'Add the contact details later under Factories'),
            Field(label: 'Their quotation no.', controller: _c['reference']!, optional: true, error: e?.field('reference')),
            Row(children: [
              Expanded(child: DateField(label: 'Date of their offer', value: _quotedOn, error: e?.field('quotedOn'), onChanged: (v) => setState(() => _quotedOn = v))),
              gap8,
              Expanded(child: DateField(label: 'Valid until', value: _validUntil, optional: true, clearable: true, error: e?.field('validUntil'), onChanged: (v) => setState(() => _validUntil = v))),
            ]),
          ]),
        ),
        SectionCard(
          title: 'Prices',
          subtitle: 'Each line can have its own VAT',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(
                width: 110,
                child: Field(label: 'Currency', controller: _c['currency']!, error: e?.field('currency'), onChanged: (_) => setState(() {}), formatters: [UpperCaseTextFormatter()]),
              ),
              gap12,
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 20),
                  child: SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: const Text('Prices include VAT'),
                    value: _inclVat,
                    onChanged: (v) => setState(() => _inclVat = v),
                  ),
                ),
              ),
            ]),
            for (var i = 0; i < _lines.length; i++) _line(context, i, cur),
            if (linesError != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(linesError, style: TextStyle(color: context.c.bad, fontSize: 12.5))),
            Row(children: [
              OutlinedButton.icon(
                onPressed: () => setState(() => _lines.add(_OfferLine(vatRate: _lines.isEmpty ? '13' : _lines.last.vatRate.text))),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Add line'),
              ),
              const Spacer(),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('Total incl. VAT', style: context.t.bodySmall),
                Text(f.cents(_totalCents, cur), style: context.t.titleMedium),
              ]),
            ]),
          ]),
        ),
        SectionCard(
          title: 'Terms',
          subtitle: 'Optional',
          child: Column(children: [
            Field(label: 'Price basis', controller: _c['priceBasis']!, optional: true, helper: 'EXW factory, FOB Qingdao, delivered to port…', error: e?.field('priceBasis')),
            Field(label: 'Lead time', controller: _c['leadTime']!, optional: true, hint: 'e.g. 45 days after deposit', error: e?.field('leadTime')),
            Field(label: 'Payment terms', controller: _c['paymentTerms']!, optional: true, hint: '30% deposit, 70% before shipment', error: e?.field('paymentTerms')),
            Field(label: 'Notes', controller: _c['notes']!, optional: true, maxLines: 3, error: e?.field('notes')),
          ]),
        ),
        BusyButton(label: 'Save offer', onPressed: _save),
      ]),
    );
  }

  Widget _line(BuildContext context, int i, String cur) {
    final l = _lines[i];
    const dec = TextInputType.numberWithOptions(decimal: true);
    final p = num.tryParse(l.unitPrice.text), v = num.tryParse(l.vatRate.text) ?? 0;
    final withVat = p == null ? null : (_inclVat ? p : p * (1 + v / 100));
    void changed(_) => setState(() {});
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 6, 6, 10),
      decoration: BoxDecoration(color: context.c.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: context.c.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: l.sourceId ?? '',
                style: context.t.labelMedium,
                items: [
                  for (final r in _requested) DropdownMenuItem(value: r.s('id'), child: Text('For: ${_name(r.s('description'))}', overflow: TextOverflow.ellipsis)),
                  const DropdownMenuItem(value: '', child: Text('Extra (not asked for)')),
                ],
                onChanged: (v) => setState(() => l.sourceId = (v == null || v.isEmpty) ? null : v),
              ),
            ),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            tooltip: 'Remove line',
            onPressed: _lines.length == 1 ? null : () => setState(() => _lines.removeAt(i).dispose()),
            icon: const Icon(Icons.delete_outline_rounded, size: 20),
          ),
        ]),
        Padding(
          padding: const EdgeInsets.only(right: 6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(controller: l.description, minLines: 1, maxLines: 5, onChanged: changed, decoration: const InputDecoration(labelText: 'What they offer', isDense: true)),
            gap8,
            Row(children: [
              Expanded(flex: 3, child: TextField(controller: l.model, decoration: const InputDecoration(labelText: 'Model', isDense: true))),
              gap8,
              Expanded(flex: 2, child: TextField(controller: l.quantity, keyboardType: dec, onChanged: changed, decoration: const InputDecoration(labelText: 'Qty', isDense: true))),
              gap8,
              Expanded(flex: 2, child: UnitField(controller: l.unit)),
            ]),
            gap8,
            Row(children: [
              Expanded(flex: 3, child: TextField(controller: l.unitPrice, keyboardType: dec, onChanged: changed, decoration: InputDecoration(labelText: 'Unit price ($cur)', isDense: true))),
              gap8,
              Expanded(flex: 2, child: TextField(controller: l.vatRate, keyboardType: dec, onChanged: changed, decoration: const InputDecoration(labelText: 'VAT', suffixText: '%', isDense: true))),
            ]),
            if (withVat != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  '${_inclVat ? 'Incl.' : '+ VAT ='} ${f.money(withVat, cur)} / ${l.unit.text.isEmpty ? 'unit' : l.unit.text} · line ${f.cents(((withVat * 100).round() * (num.tryParse(l.quantity.text) ?? 0)).round(), cur)} incl. VAT',
                  textAlign: TextAlign.right,
                  style: context.t.bodySmall,
                ),
              ),
          ]),
        ),
      ]),
    );
  }
}

class UpperCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) => newValue.copyWith(text: newValue.text.toUpperCase());
}

class _FactorySearchSheet extends ConsumerStatefulWidget {
  const _FactorySearchSheet();
  @override
  ConsumerState<_FactorySearchSheet> createState() => _FactorySearchSheetState();
}

class _FactorySearchSheetState extends ConsumerState<_FactorySearchSheet> {
  List<Json> _results = [];
  String _q = '';
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _search('');
  }

  Future<void> _search(String q) async {
    setState(() {
      _q = q;
      _loading = true;
    });
    try {
      final res = await ref.read(apiProvider).get('/api/v1/factories', query: {'q': q});
      if (mounted && _q == q) setState(() => _results = res.l('rows'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 4), child: Align(alignment: Alignment.centerLeft, child: Text('Choose a factory', style: context.t.titleLarge))),
          SearchBox(hint: 'Factory or contact name…', onChanged: _search),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: ListView(children: [
              ListTile(
                leading: Icon(Icons.add_business_outlined, color: context.c.primary),
                title: Text(_q.trim().isEmpty ? 'New factory…' : 'New factory "${_q.trim()}"'),
                onTap: () => Navigator.pop(context, <String, dynamic>{'id': _newFactory, 'name': _q.trim()}),
              ),
              for (final s in _results)
                ListTile(
                  leading: const Icon(Icons.factory_outlined),
                  title: Text(s.s('name')),
                  subtitle: Text([if (s.sn('contactPerson') != null) s.s('contactPerson'), 'VAT ${num.tryParse(s.s('defaultVatRate')) ?? 0}%'].join(' · ')),
                  onTap: () => Navigator.pop(context, s),
                ),
            ]),
          ),
        ]),
      ),
    );
  }
}
