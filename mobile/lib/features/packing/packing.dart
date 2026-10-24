import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/docs.dart';
import '../../ui/kit.dart';

/* ---------------------------------------------------------------- Detail */

class PackingDetailScreen extends ConsumerWidget {
  const PackingDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(getProvider('/api/v1/packing-lists/$id'));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/packing-lists/$id')))),
      data: (d) {
        final pl = d.m('packingList');
        final t = d.m('totals');
        final shipment = [
          ('Terms of delivery', pl.s('incoterm')),
          ('Port of loading', pl.s('portOfLoading')),
          ('Port of discharge', pl.s('portOfDischarge')),
          ('Final destination', pl.s('finalDestination')),
          ('Vessel / transport', pl.s('transport')),
          ('Container no.', pl.s('containerNo')),
          ('Seal no.', pl.s('sealNo')),
        ].where((r) => r.$2.isNotEmpty).toList();
        return Scaffold(
          appBar: AppBar(
            title: Text(pl.s('plNo'), style: mono13(context).copyWith(fontSize: 17, fontWeight: FontWeight.w600)),
            actions: [
              PdfButton(path: d.s('pdf'), fileName: '${pl.s('plNo')} ${f.customerName(d.m('customer'))}'),
              IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/packing-lists/$id/edit')),
              PopupMenuButton<String>(
                onSelected: (_) async {
                  if (!await confirm(context, title: 'Remove packing list ${pl.s('plNo')}?', message: 'It is removed from the inquiry.', action: 'Remove', danger: true)) return;
                  try {
                    await ref.mutate(() => ref.read(apiProvider).delete('/api/v1/packing-lists/$id'));
                    if (context.mounted) {
                      toast(context, 'Packing list removed');
                      context.pop();
                    }
                  } catch (e) {
                    if (context.mounted) toast(context, e.toString(), error: true);
                  }
                },
                itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('Remove packing list'))],
              ),
            ],
          ),
          body: ListView(padding: pagePadding, children: [
            Text(d.m('query').s('title'), style: context.t.titleLarge),
            gap4,
            Text('${f.customerName(d.m('customer'))} · for ${d.m('invoice').s('invoiceNo')} · packed ${f.date(pl.s('packDate'))}', style: context.t.bodySmall),
            gap16,
            FigureBand([('Packages', '${t.i('packages')}'), ('Volume', f.cbm(t.n('cbm'))), ('Net weight', f.kg(t.n('netKg'))), ('Gross weight', f.kg(t.n('grossKg')))]),
            gap12,
            SectionCard(
              title: 'Goods',
              padding: EdgeInsets.zero,
              child: CardList(children: [
                for (final it in d.l('items'))
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(it.s('description'), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                      gap4,
                      Text('${f.qty(it['quantity'])} ${it.s('unit')}${it.i('packages') > 0 ? ' · ${it.i('packages')} × ${it.s('packageType').toLowerCase()}' : ''}', style: context.t.bodySmall),
                      Text('N.W. ${f.kg(num.tryParse(it.s('netWeight')) ?? 0)} · G.W. ${f.kg(num.tryParse(it.s('grossWeight')) ?? 0)} · ${f.cbm(num.tryParse(it.s('cbm')) ?? 0)}', style: context.t.bodySmall),
                    ]),
                  ),
              ]),
            ),
            SectionCard(title: 'Shipment', child: shipment.isEmpty ? Text('Ports, vessel and container details to follow.', style: context.t.bodySmall) : kv(shipment)),
            if (pl.sn('marks') != null) SectionCard(title: 'Shipping marks & numbers', child: SelectableText(pl.s('marks'), style: mono13(context))),
            if (pl.sn('notes') != null) SectionCard(title: 'Remarks', child: Text(pl.s('notes'), style: context.t.bodyMedium!.copyWith(color: context.c.text2))),
            OutlinedButton.icon(onPressed: () => context.push('/inquiries/${d.m('query').s('id')}'), icon: const Icon(Icons.inbox_outlined, size: 18), label: Text('Open inquiry ${d.m('query').s('refNo')}')),
          ]),
        );
      },
    );
  }
}

/* ---------------------------------------------------------------- Form */

class _Line {
  _Line(Json j)
      : description = TextEditingController(text: j.s('description')),
        quantity = TextEditingController(text: _n(j.s('quantity', '1'))),
        unit = TextEditingController(text: j.s('unit', 'pcs')),
        packages = TextEditingController(text: j.s('packages', '1')),
        packageType = TextEditingController(text: j.s('packageType', 'Wooden case')),
        net = TextEditingController(text: _opt(j.s('netWeight'))),
        gross = TextEditingController(text: _opt(j.s('grossWeight'))),
        cbm = TextEditingController(text: _opt(j.s('cbm')));
  final TextEditingController description, quantity, unit, packages, packageType, net, gross, cbm;
  static String _n(String v) => (num.tryParse(v) ?? 1).toString().replaceAll(RegExp(r'\.0$'), '');
  static String _opt(String v) => (num.tryParse(v) ?? 0) == 0 ? '' : (num.tryParse(v)!).toString().replaceAll(RegExp(r'\.0$'), '');
  Map<String, String> toJson() => {
        'description': description.text.trim(),
        'quantity': quantity.text.trim(),
        'unit': unit.text.trim(),
        'packages': packages.text.trim(),
        'packageType': packageType.text.trim(),
        'netWeight': net.text.trim(),
        'grossWeight': gross.text.trim(),
        'cbm': cbm.text.trim(),
      };
}

class PackingFormScreen extends ConsumerStatefulWidget {
  const PackingFormScreen({super.key, this.invoiceId, this.editId});
  final String? invoiceId;
  final String? editId;
  @override
  ConsumerState<PackingFormScreen> createState() => _PackingFormScreenState();
}

class _PackingFormScreenState extends ConsumerState<PackingFormScreen> {
  final _lines = <_Line>[];
  final _f = {for (final k in ['incoterm', 'portOfLoading', 'portOfDischarge', 'finalDestination', 'transport', 'containerNo', 'sealNo', 'marks', 'notes']) k: TextEditingController()};
  String _packDate = '';
  String _subtitle = '';
  bool _loaded = false;
  Object? _loadError;
  ApiException? _error;
  List<String> _types = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    try {
      Json init;
      if (widget.editId != null) {
        final d = await api.get('/api/v1/packing-lists/${widget.editId}');
        final pl = d.m('packingList');
        init = {...pl, 'items': d.l('items')};
        _subtitle = '${pl.s('plNo')} · for ${d.m('invoice').s('invoiceNo')} · ${f.customerName(d.m('customer'))}';
      } else {
        final d = await api.get('/api/v1/packing-lists/new', query: {'invoice': widget.invoiceId});
        init = d.m('initial');
        _subtitle = 'For ${d.m('invoice').s('invoiceNo')} · ${f.customerName(d.m('customer'))} · ${d.m('query').s('refNo')}';
      }
      _types = (await ref.read(metaProvider.future)).m('packing').ls('packageTypes');
      _lines.addAll(init.l('items').map(_Line.new));
      if (_lines.isEmpty) _lines.add(_Line(const {}));
      _packDate = init.s('packDate', f.today());
      for (final e in _f.entries) {
        e.value.text = init.s(e.key);
      }
      setState(() => _loaded = true);
    } catch (e) {
      setState(() => _loadError = e);
    }
  }

  ({int packages, double net, double gross, double cbm}) get _totals {
    var p = 0;
    var n = 0, g = 0, c = 0;
    for (final l in _lines) {
      p += int.tryParse(l.packages.text) ?? 0;
      n += ((double.tryParse(l.net.text) ?? 0) * 1000).round();
      g += ((double.tryParse(l.gross.text) ?? 0) * 1000).round();
      c += ((double.tryParse(l.cbm.text) ?? 0) * 1000000).round();
    }
    return (packages: p, net: n / 1000, gross: g / 1000, cbm: c / 1000000);
  }

  Future<void> _save() async {
    setState(() => _error = null);
    final body = {
      'items': [for (final l in _lines) if (l.description.text.trim().isNotEmpty) l.toJson()],
      'packDate': _packDate,
      for (final e in _f.entries) e.key: e.value.text,
    };
    final api = ref.read(apiProvider);
    try {
      if (widget.editId != null) {
        await ref.mutate(() => api.patch('/api/v1/packing-lists/${widget.editId}', body));
        if (mounted) {
          toast(context, 'Packing list saved');
          context.pop();
        }
      } else {
        final res = await ref.mutate(() => api.post('/api/v1/packing-lists', {...body, 'invoiceId': widget.invoiceId}));
        if (mounted) {
          toast(context, 'Packing list ${res.s('plNo')} created');
          context.pushReplacement('/packing-lists/${res.s('id')}');
        }
      }
    } on ApiException catch (e) {
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.editId == null ? 'New packing list' : 'Edit packing list';
    if (_loadError != null) return Scaffold(appBar: AppBar(title: Text(title)), body: ErrorState(_loadError!, onRetry: _load));
    if (!_loaded) return Scaffold(appBar: AppBar(title: Text(title)), body: const LoadingView());
    final e = _error;
    final t = _totals;
    InputDecoration dec(String label, {String? hint}) => InputDecoration(labelText: label, hintText: hint);
    const numKb = TextInputType.numberWithOptions(decimal: true);

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(padding: pagePadding, children: [
        Text(_subtitle, style: context.t.bodySmall),
        gap12,
        if (e != null) Notice(e.field('items') ?? (e.fieldErrors.isNotEmpty ? 'Please fix the highlighted fields.' : e.message), tone: Tone.bad),
        SectionCard(
          title: 'Goods & packing',
          subtitle: 'Copied from the invoice. Remove lines that are not shipped (freight, installation). Weights and volume are per line.',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (var i = 0; i < _lines.length; i++)
              Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.fromLTRB(12, 8, 6, 10),
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: context.c.line)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Text('Line ${i + 1}', style: context.t.labelMedium),
                    const Spacer(),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: _lines.length == 1 ? null : () => setState(() => _lines.removeAt(i)),
                      icon: const Icon(Icons.delete_outline_rounded, size: 20),
                    ),
                  ]),
                  TextField(controller: _lines[i].description, maxLines: 4, minLines: 1, decoration: const InputDecoration(hintText: 'e.g. Rotary tablet press ZP-35, with spare punches')),
                  gap8,
                  Row(children: [
                    Expanded(child: TextField(controller: _lines[i].quantity, keyboardType: numKb, decoration: dec('Qty'))),
                    gap8,
                    Expanded(child: TextField(controller: _lines[i].unit, decoration: dec('Unit'))),
                    gap8,
                    Expanded(child: TextField(controller: _lines[i].packages, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}), decoration: dec('Packages'))),
                  ]),
                  gap8,
                  Autocomplete<String>(
                    initialValue: TextEditingValue(text: _lines[i].packageType.text),
                    optionsBuilder: (v) => _types.where((o) => o.toLowerCase().contains(v.text.toLowerCase())),
                    onSelected: (v) => _lines[i].packageType.text = v,
                    fieldViewBuilder: (ctx, ctrl, focus, _) => TextField(controller: ctrl, focusNode: focus, onChanged: (v) => _lines[i].packageType.text = v, decoration: dec('Packed in', hint: 'Wooden case, carton, pallet…')),
                  ),
                  gap8,
                  Row(children: [
                    Expanded(child: TextField(controller: _lines[i].net, keyboardType: numKb, onChanged: (_) => setState(() {}), decoration: dec('Net kg'))),
                    gap8,
                    Expanded(
                      child: TextField(
                        controller: _lines[i].gross,
                        keyboardType: numKb,
                        onChanged: (_) => setState(() {}),
                        decoration: dec('Gross kg').copyWith(
                          errorText: (double.tryParse(_lines[i].gross.text) ?? 0) > 0 && (double.tryParse(_lines[i].gross.text) ?? 0) < (double.tryParse(_lines[i].net.text) ?? 0) ? 'Below net' : null,
                        ),
                      ),
                    ),
                    gap8,
                    Expanded(child: TextField(controller: _lines[i].cbm, keyboardType: numKb, onChanged: (_) => setState(() {}), decoration: dec('CBM m³'))),
                  ]),
                ]),
              ),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: () => setState(() => _lines.add(_Line({'packageType': _lines.isEmpty ? 'Wooden case' : _lines.last.packageType.text}))),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Add line'),
              ),
            ),
            gap12,
            FigureBand([('Packages', '${t.packages}'), ('Volume', f.cbm(t.cbm)), ('Net', f.kg(t.net)), ('Gross', f.kg(t.gross))], dark: false),
          ]),
        ),
        SectionCard(
          title: 'Shipment',
          subtitle: 'Fill in what you know now; it stays editable until the goods leave.',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            DateField(label: 'Packing date', value: _packDate, error: e?.field('packDate'), onChanged: (v) => setState(() => _packDate = v)),
            Field(label: 'Terms of delivery', controller: _f['incoterm']!, optional: true, hint: 'e.g. FOB Qingdao, CIF Karachi'),
            Field(label: 'Port of loading', controller: _f['portOfLoading']!, optional: true, hint: 'Qingdao, China'),
            Field(label: 'Port of discharge', controller: _f['portOfDischarge']!, optional: true),
            Field(label: 'Final destination', controller: _f['finalDestination']!, optional: true),
            Field(label: 'Vessel / transport', controller: _f['transport']!, optional: true, helper: 'Vessel and voyage, flight, or truck'),
            Field(label: 'Container no.', controller: _f['containerNo']!, optional: true, hint: 'e.g. 1 × 40HQ MSKU1234567'),
            Field(label: 'Seal no.', controller: _f['sealNo']!, optional: true),
            Field(label: 'Shipping marks & numbers', controller: _f['marks']!, optional: true, maxLines: 4, mono: true, helper: 'As painted on the cases'),
            Field(label: 'Remarks', controller: _f['notes']!, optional: true, maxLines: 3),
          ]),
        ),
        BusyButton(label: widget.editId == null ? 'Create packing list' : 'Save packing list', onPressed: _save),
      ]),
    );
  }
}
