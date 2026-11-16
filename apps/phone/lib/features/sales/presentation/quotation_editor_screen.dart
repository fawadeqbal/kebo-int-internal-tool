import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../data/sales_data.dart';

/// The quotation on the phone: a new revision starts from the server's draft (a copy of the
/// latest, or the best factory offer at the default margin), or a saved draft is opened.
/// Each line shows its cost (Internal) and our price; a margin sets every price at once.
/// Charges, extra options and the PDF stay on the web.
class QuotationEditorScreen extends ConsumerStatefulWidget {
  const QuotationEditorScreen({super.key, required this.inquiryId, this.revisionId});
  final String inquiryId;
  final String? revisionId;

  @override
  ConsumerState<QuotationEditorScreen> createState() => _QuotationEditorScreenState();
}

class _QuotationEditorScreenState extends ConsumerState<QuotationEditorScreen> {
  Json? _values;
  Map<String, Json> _lines = const {}; // lineId → the factory line (description, qty, cost)
  Map<String, String> _factory = const {}; // factoryQuoteId → factory name
  final _prices = <String, TextEditingController>{};
  final _terms = TextEditingController();
  final _margin = TextEditingController();
  DateTime? _validUntil;
  String? _error;
  bool _busy = false, _saved = false;

  Api get _api => ref.read(sessionProvider.notifier).api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [..._prices.values, _terms, _margin]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final v = widget.revisionId == null
          ? await _api.get('/api/inquiries/${widget.inquiryId}/quotation/draft')
          : await _api.get('/api/revisions/${widget.revisionId}/values');
      final offers = await _api.get(
        '/api/inquiries/${widget.inquiryId}/quotation/offers',
        query: {'currency': ?v.strOrNull('currency')},
      );
      final lines = <String, Json>{}, names = <String, String>{};
      for (final o in offers.list('offers', (m) => m)) {
        names[o.str('factoryQuoteId')] = o.at('factory.name') ?? 'Factory';
        for (final l in o.list('lines', (m) => m)) {
          lines[l.str('id')] = l;
        }
      }
      for (final o in v.list('options', (m) => m)) {
        for (final p in o.list('prices', (m) => m)) {
          _prices[p.str('lineId')] = TextEditingController(text: '${p['unitPrice'] ?? ''}');
        }
      }
      setState(() {
        _values = v;
        _lines = lines;
        _factory = names;
        _terms.text = v.strOrNull('paymentTerms') ?? '';
        _validUntil = DateTime.tryParse(v.str('validUntil'));
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  num _n(String? s) => num.tryParse((s ?? '').replaceAll(',', '')) ?? 0;

  void _applyMargin() {
    final m = _n(_margin.text);
    if (m <= 0 || m >= 95) {
      showKToast(context, 'A margin between 1 and 94 %.');
      return;
    }
    setState(() {
      for (final e in _prices.entries) {
        final cost = _n(_lines[e.key]?.strOrNull('unitCost'));
        if (cost > 0) e.value.text = (cost / (1 - m / 100)).toStringAsFixed(2);
      }
    });
    KHaptics.toggle();
  }

  ({num sell, num cost}) _totals() {
    num sell = 0, cost = 0;
    for (final e in _prices.entries) {
      final q = _n(_lines[e.key]?.strOrNull('quantity'));
      sell += q * _n(e.value.text);
      cost += q * _n(_lines[e.key]?.strOrNull('unitCost'));
    }
    return (sell: sell, cost: cost);
  }

  Future<void> _save() async {
    final v = Map<String, dynamic>.from(_values!)..remove('number');
    v['paymentTerms'] = _terms.text.trim().isEmpty ? null : _terms.text.trim();
    v['validUntil'] = isoDay(_validUntil);
    v['options'] = [
      for (final o in _values!.list('options', (m) => m))
        {
          ...o,
          'prices': [
            for (final p in o.list('prices', (m) => m))
              {'lineId': p.str('lineId'), 'unitPrice': _prices[p.str('lineId')]?.text.trim() ?? p['unitPrice']},
          ],
        },
    ];
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (widget.revisionId == null) {
        await _api.post('/api/inquiries/${widget.inquiryId}/quotation/revisions', v);
      } else {
        await _api.put('/api/revisions/${widget.revisionId}', v);
      }
      ref.invalidate(quotationProvider(widget.inquiryId));
      setState(() => _saved = true);
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.fieldErrors.isEmpty ? e.message : e.fieldErrors.values.first;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final v = _values;
    final cur = v?.strOrNull('currency');
    return Scaffold(
      backgroundColor: c.bg,
      appBar: KTopBar(
        title: widget.revisionId == null ? 'New revision' : 'Draft revision',
        leading: KTopBarLeading.close,
      ),
      bottomNavigationBar: v == null || _saved
          ? null
          : Builder(
              builder: (context) {
                final t = _totals();
                final m = t.sell > 0 && t.cost > 0 ? (t.sell - t.cost) / t.sell * 100 : null;
                return KStickyBar(
                  note:
                      'Total ${fmtMoney(t.sell.toStringAsFixed(2), cur)}${m == null ? '' : ' · margin ${m.toStringAsFixed(1)}% (Internal)'}',
                  primary: KButton('Save as draft', fullWidth: true, loading: _busy, onPressed: _save),
                );
              },
            ),
      body: _saved
          ? Center(
              child: SuccessCheck(label: 'Revision saved as a draft', onDone: () => context.pop()),
            )
          : v == null
          ? Padding(
              padding: const EdgeInsets.all(KSpace.s4),
              child: _error == null ? const KSkeleton(height: 240) : KBanner(_error!, tone: KTone.danger),
            )
          : ListView(
              padding: const EdgeInsets.all(KSpace.s4),
              children: [
                if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
                KDetails(
                  title: 'Revision ${v.integer('number') == 0 ? '' : v.integer('number')}'.trim(),
                  items: [
                    KDetail('Currency', cur),
                    KDetail('Price basis', '${v.str('incoterm')} ${v.strOrNull('incotermPlace') ?? ''}'.trim()),
                    KDetail('Advance', '${v['depositPercent'] ?? 30}%'),
                  ],
                ),
                const SizedBox(height: KSpace.s4),
                KSelectField(
                  label: 'Valid until',
                  value: fmtDate(_validUntil),
                  icon: KIcons.calendar,
                  onTap: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _validUntil ?? CompanyTime.today(),
                      firstDate: CompanyTime.today(),
                      lastDate: CompanyTime.today().add(const Duration(days: 365)),
                    );
                    if (d != null) setState(() => _validUntil = d);
                  },
                ),
                const SizedBox(height: KSpace.s4),
                KTextField(label: 'Payment terms', controller: _terms, optional: true, multiline: true),
                const SizedBox(height: KSpace.s6),
                KCard(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: KTextField(
                          label: 'Margin for every line',
                          controller: _margin,
                          suffix: '%',
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        ),
                      ),
                      const SizedBox(width: KSpace.s3),
                      KButton('Apply', variant: KButtonVariant.secondary, onPressed: _applyMargin),
                    ],
                  ),
                ),
                for (final (i, o) in v.list('options', (m) => m).indexed) ...[
                  const SizedBox(height: KSpace.s6),
                  KSection(
                    title:
                        '${v.list('options', (m) => m).length > 1 ? 'Option ${String.fromCharCode(65 + i)} · ' : ''}${_factory[o.strOrNull('factoryQuoteId')] ?? 'Our own lines'}',
                    children: [
                      for (final p in o.list('prices', (m) => m))
                        Builder(
                          builder: (context) {
                            final l = _lines[p.str('lineId')];
                            final cost = _n(l?.strOrNull('unitCost'));
                            final price = _n(_prices[p.str('lineId')]?.text);
                            final m = cost > 0 && price > 0 ? (price - cost) / price * 100 : null;
                            return Padding(
                              padding: const EdgeInsets.only(bottom: KSpace.s3),
                              child: KTextField(
                                label: '${l?.strOrNull('no') ?? ''} ${l?.strOrNull('description') ?? 'Line'}'.trim(),
                                controller: _prices[p.str('lineId')],
                                prefix: cur,
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                onChanged: (_) => setState(() {}),
                                help: [
                                  '${l?.strOrNull('quantity') ?? ''} ${l?.strOrNull('unit') ?? ''}'.trim(),
                                  if (cost > 0) 'cost ${fmtMoney(cost.toStringAsFixed(2), cur)} (Internal)',
                                  if (m != null) 'margin ${m.toStringAsFixed(1)}%',
                                ].where((x) => x.isNotEmpty).join(' · '),
                                error: m != null && m < 0 ? 'Below cost' : null,
                              ),
                            );
                          },
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: KSpace.s4),
                Text(
                  'Charges, more options and the PDF are on the web.',
                  textAlign: TextAlign.center,
                  style: KType.footnote.copyWith(color: c.inkMuted),
                ),
              ],
            ),
    );
  }
}
