import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/pick_sheet.dart';
import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../data/sales_data.dart';

/// The factories asked for a price on an inquiry, who answered, and their offers.
final factoryRequestsProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async {
  return ref.watch(sessionProvider.notifier).api.get('/api/inquiries/$id/factory-requests');
});

final sourcingProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async {
  return ref.watch(sessionProvider.notifier).api.get('/api/inquiries/$id/sourcing');
});

const _channels = {
  'wechat': 'WeChat',
  'email': 'Email',
  'whatsapp': 'WhatsApp',
  'phone': 'Phone',
  'visit': 'Visit',
  'other': 'Other',
};

class FactoryPricesScreen extends ConsumerWidget {
  const FactoryPricesScreen({super.key, required this.inquiryId});
  final String inquiryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final req = ref.watch(factoryRequestsProvider(inquiryId));
    final src = ref.watch(sourcingProvider(inquiryId));
    final inquiry = ref.watch(inquiryProvider(inquiryId)).value;
    final api = ref.read(sessionProvider.notifier).api;
    void reload() {
      ref.invalidate(factoryRequestsProvider(inquiryId));
      ref.invalidate(sourcingProvider(inquiryId));
      ref.invalidate(inquiryProvider(inquiryId));
    }

    final counts = req.value?.objAt('counts');
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: const KTopBar(title: 'Supplier prices'),
      body: RefreshIndicator(
        onRefresh: () async => reload(),
        child: ListView(
          padding: const EdgeInsets.all(KSpace.s4),
          children: [
            if (inquiry != null)
              Text('${inquiry.refNo} · ${inquiry.what}', style: KType.callout.copyWith(color: context.k.inkMuted)),
            const SizedBox(height: KSpace.s3),
            if (counts != null)
              Row(
                children: [
                  Expanded(
                    child: KStatTile(label: 'Asked', value: '${counts.integer('asked')}'),
                  ),
                  const SizedBox(width: KSpace.s2),
                  Expanded(
                    child: KStatTile(label: 'Answered', value: '${counts.integer('quoted')}'),
                  ),
                  const SizedBox(width: KSpace.s2),
                  Expanded(
                    child: KStatTile(label: 'Late', value: '${counts.integer('late')}', deltaTone: KTone.danger),
                  ),
                ],
              ),
            const SizedBox(height: KSpace.s6),
            KSection(
              title: 'Asked',
              actionLabel: 'Ask suppliers',
              onAction: req.value == null
                  ? null
                  : () async {
                      if (await showKSheet<bool>(
                            context,
                            title: 'Ask suppliers for a price',
                            builder: (_) =>
                                _Ask(inquiryId: inquiryId, suggestions: req.value!.list('suggestions', (m) => m)),
                          ) ==
                          true) {
                        reload();
                      }
                    },
              children: [
                KCard(
                  padding: EdgeInsets.zero,
                  child: switch (req) {
                    AsyncValue(:final value?) when value.list('items', (m) => m).isEmpty => const KEmptyState(
                      icon: KIcons.factory,
                      title: 'No supplier asked yet',
                      message: 'Ask a few suppliers for their price; their offers come here.',
                    ),
                    AsyncValue(:final value?) => Column(
                      children: [
                        for (final (i, r) in value.list('items', (m) => m).indexed)
                          KListItem(
                            leading: KAvatar(r.at('factory.name') ?? '?', size: KAvatarSize.sm),
                            title: r.at('factory.name') ?? '',
                            subtitle: [
                              if (r.strOrNull('channel') != null) _channels[r.str('channel')],
                              if (r.strOrNull('sentOn') != null)
                                'asked ${fmtDayMonth(DateTime.tryParse(r.str('sentOn')))}',
                              if (r.strOrNull('replyBy') != null)
                                'reply by ${fmtDayMonth(DateTime.tryParse(r.str('replyBy')))}',
                            ].whereType<String>().join(' · '),
                            status: KBadge(
                              r.str('status') == 'sent' && r['waitingDays'] is num
                                  ? 'Waiting ${r['waitingDays']} d'
                                  : r.str('statusLabel', r.str('status')),
                              tone: r.boolean('late')
                                  ? KTone.danger
                                  : switch (r.str('status')) {
                                      'quoted' => KTone.success,
                                      'sent' => KTone.warning,
                                      _ => KTone.neutral,
                                    },
                            ),
                            divider: i < value.list('items', (m) => m).length - 1,
                            onPressed: r.str('status') == 'sent' ? () => _answered(context, api, r, reload) : null,
                          ),
                      ],
                    ),
                    AsyncValue(:final error?) => Padding(
                      padding: const EdgeInsets.all(KSpace.s4),
                      child: KBanner(error.toString(), tone: KTone.danger),
                    ),
                    _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 64)),
                  },
                ),
              ],
            ),
            const SizedBox(height: KSpace.s6),
            KSection(
              title: 'Offers',
              actionLabel: 'Add an offer',
              onAction: inquiry == null || req.value == null
                  ? null
                  : () async {
                      final ok = await showKSheet<bool>(
                        context,
                        title: 'An offer came in',
                        builder: (_) => _Offer(inquiry: inquiry, factories: req.value!.list('suggestions', (m) => m)),
                      );
                      if (ok == true) reload();
                    },
              children: [
                KCard(
                  padding: EdgeInsets.zero,
                  child: switch (src) {
                    AsyncValue(:final value?) when value.list('quotes', (m) => m).isEmpty => const KEmptyState(
                      icon: KIcons.file,
                      title: 'No offers yet',
                      message: 'When a supplier answers, add its prices here.',
                    ),
                    AsyncValue(:final value?) => Column(
                      children: [
                        for (final (i, q) in value.list('quotes', (m) => m).indexed)
                          KListItem(
                            title: q.at('factory.name') ?? 'Supplier',
                            subtitle: [
                              fmtMoney(q.strOrNull('factoryTotal'), q.strOrNull('currency')),
                              if (q.strOrNull('basis') != null)
                                '${q.str('basis')} ${q.strOrNull('basisPlace') ?? ''}'.trim(),
                              if (q.strOrNull('leadTime') != null) q.str('leadTime'),
                            ].whereType<String>().join(' · '),
                            meta:
                                'Received ${fmtDate(DateTime.tryParse(q.str('receivedOn')))} · ${q.list('lines', (m) => m).length} lines',
                            status: q.integer('unpriced') > 0
                                ? KBadge('${q.integer('unpriced')} without a price', tone: KTone.warning)
                                : null,
                            divider: i < value.list('quotes', (m) => m).length - 1,
                            chevron: false,
                          ),
                      ],
                    ),
                    AsyncValue(:final error?) => Padding(
                      padding: const EdgeInsets.all(KSpace.s4),
                      child: KBanner(error.toString(), tone: KTone.danger),
                    ),
                    _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 64)),
                  },
                ),
              ],
            ),
            const SizedBox(height: KSpace.s4),
            Text(
              'Compare the offers and make the quotation on the web.',
              textAlign: TextAlign.center,
              style: KType.footnote.copyWith(color: context.k.inkMuted),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _answered(BuildContext context, Api api, Json r, VoidCallback reload) async {
    final pick = await showKSheet<String>(
      context,
      title: r.at('factory.name') ?? 'Supplier',
      builder: (ctx) => Column(
        children: [
          KListItem(title: 'They declined', chevron: false, onPressed: () => Navigator.pop(ctx, 'declined')),
          KListItem(title: 'No reply', chevron: false, onPressed: () => Navigator.pop(ctx, 'no_reply')),
          KListItem(
            title: 'Not asked after all',
            subtitle: 'Removes them from this inquiry',
            divider: false,
            chevron: false,
            onPressed: () => Navigator.pop(ctx, 'delete'),
          ),
        ],
      ),
    );
    if (pick == null) return;
    try {
      if (pick == 'delete') {
        await api.delete('/api/factory-requests/${r.str('id')}');
      } else {
        await api.patch('/api/factory-requests/${r.str('id')}', {'status': pick});
      }
      reload();
    } on ApiException catch (e) {
      if (context.mounted) showKToast(context, e.message, icon: KIcons.error);
    }
  }
}

class _Ask extends ConsumerStatefulWidget {
  const _Ask({required this.inquiryId, required this.suggestions});
  final String inquiryId;
  final List<Json> suggestions;

  @override
  ConsumerState<_Ask> createState() => _AskState();
}

class _AskState extends ConsumerState<_Ask> {
  final _picked = <String>{};
  String _channel = 'wechat';
  DateTime? _by = CompanyTime.today().add(const Duration(days: 3));
  final _note = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_picked.isEmpty) {
      setState(() => _error = 'Choose at least one supplier.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).api.post('/api/inquiries/${widget.inquiryId}/factory-requests', {
        'factoryIds': _picked.toList(),
        'channel': _channel,
        'sentOn': isoDay(CompanyTime.today()),
        'replyBy': ?isoDay(_by),
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      KHaptics.success();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final free = widget.suggestions.where((f) => !f.boolean('askedHere')).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        Text('Recently asked first.', style: KType.footnote.copyWith(color: context.k.inkMuted)),
        for (final f in free.take(25))
          KCheckbox(
            label: f.str('name'),
            help: [
              if (f.integer('offers') > 0) '${f.integer('offers')} offers before',
              if (f.strOrNull('lastAskedOn') != null)
                'last asked ${fmtDayMonth(DateTime.tryParse(f.str('lastAskedOn')))}',
            ].join(' · '),
            value: _picked.contains(f.str('id')),
            onChanged: (v) => setState(() => v ? _picked.add(f.str('id')) : _picked.remove(f.str('id'))),
          ),
        const SizedBox(height: KSpace.s4),
        Text('Asked by', style: KType.label.copyWith(color: context.k.ink)),
        const SizedBox(height: KSpace.s2),
        Wrap(
          spacing: KSpace.s2,
          runSpacing: KSpace.s2,
          children: [
            for (final e in _channels.entries)
              KChip(e.value, selected: _channel == e.key, onPressed: () => setState(() => _channel = e.key)),
          ],
        ),
        const SizedBox(height: KSpace.s4),
        KSelectField(
          label: 'Reply by',
          optional: true,
          value: fmtDate(_by),
          icon: KIcons.calendar,
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _by ?? CompanyTime.today(),
              firstDate: CompanyTime.today(),
              lastDate: CompanyTime.today().add(const Duration(days: 90)),
            );
            if (d != null) setState(() => _by = d);
          },
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(label: 'Note', controller: _note, optional: true),
        const SizedBox(height: KSpace.s6),
        KButton(
          _picked.isEmpty ? 'Ask' : 'Ask ${_picked.length} factor${_picked.length == 1 ? 'y' : 'ies'}',
          fullWidth: true,
          loading: _busy,
          onPressed: _send,
        ),
      ],
    );
  }
}

/// An offer from a factory: who, when, its terms, and a price for each requested item.
class _Offer extends ConsumerStatefulWidget {
  const _Offer({required this.inquiry, required this.factories});
  final Inquiry inquiry;
  final List<Json> factories;

  @override
  ConsumerState<_Offer> createState() => _OfferState();
}

class _OfferState extends ConsumerState<_Offer> {
  Choice? _factory;
  DateTime _on = CompanyTime.today();
  String _currency = 'CNY';
  final _lead = TextEditingController();
  final _terms = TextEditingController();
  final _ref = TextEditingController();
  late final _prices = {for (final it in widget.inquiry.items) it.id: TextEditingController()};
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_lead, _terms, _ref, ..._prices.values]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_factory == null) {
      setState(() => _error = 'Choose the supplier.');
      return;
    }
    final lines = [
      for (final it in widget.inquiry.items)
        if (_prices[it.id]!.text.trim().isNotEmpty)
          {
            'requestedItemId': it.id,
            'description': it.description,
            'model': ?it.model,
            'quantity': it.quantity,
            'unit': it.unit,
            'unitPrice': _prices[it.id]!.text.trim(),
          },
    ];
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).api.post('/api/inquiries/${widget.inquiry.id}/factory-quotes', {
        'factoryId': _factory!.id,
        'receivedOn': isoDay(_on),
        'currency': _currency,
        if (_ref.text.trim().isNotEmpty) 'reference': _ref.text.trim(),
        if (_lead.text.trim().isNotEmpty) 'leadTime': _lead.text.trim(),
        if (_terms.text.trim().isNotEmpty) 'paymentTerms': _terms.text.trim(),
        'lines': lines,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        KSelectField(
          label: 'Supplier',
          value: _factory?.name,
          placeholder: 'Choose the supplier',
          icon: KIcons.search,
          onTap: () async {
            final f = await showPickSheet(
              context,
              title: 'Supplier',
              choices: [
                for (final f in widget.factories)
                  Choice(f.str('id'), f.str('name'), f.boolean('askedHere') ? 'Asked on this inquiry' : null),
              ],
            );
            if (f != null) setState(() => _factory = f);
          },
        ),
        const SizedBox(height: KSpace.s4),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: KSelectField(
                label: 'Received',
                value: fmtDate(_on),
                icon: KIcons.calendar,
                onTap: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _on,
                    firstDate: DateTime(2020),
                    lastDate: CompanyTime.today(),
                  );
                  if (d != null) setState(() => _on = d);
                },
              ),
            ),
            const SizedBox(width: KSpace.s3),
            SizedBox(
              width: 120,
              child: KSegmented<String>(
                value: _currency,
                onChanged: (v) => setState(() => _currency = v),
                segments: const [('CNY', 'CNY'), ('USD', 'USD')],
              ),
            ),
          ],
        ),
        const SizedBox(height: KSpace.s5),
        Text('Prices', style: KType.title3.copyWith(color: c.ink)),
        Text(
          'Each per unit, in $_currency. Leave empty what they did not price.',
          style: KType.footnote.copyWith(color: c.inkMuted),
        ),
        const SizedBox(height: KSpace.s2),
        if (widget.inquiry.items.isEmpty)
          const KBanner('This inquiry has no items yet. Add the items on the web.', tone: KTone.warning),
        for (final it in widget.inquiry.items) ...[
          KTextField(
            label: '${it.no ?? ''} ${it.description}'.trim(),
            controller: _prices[it.id],
            prefix: _currency,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            help: '${it.quantity} ${it.unit}${it.model == null ? '' : ' · ${it.model}'}',
          ),
          const SizedBox(height: KSpace.s3),
        ],
        const SizedBox(height: KSpace.s2),
        KTextField(label: 'Lead time', controller: _lead, optional: true, hint: '45 days after deposit'),
        const SizedBox(height: KSpace.s4),
        KTextField(
          label: 'Payment terms',
          controller: _terms,
          optional: true,
          hint: '30% deposit, 70% before shipment',
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(label: 'Their reference', controller: _ref, optional: true),
        const SizedBox(height: KSpace.s6),
        KButton('Save the offer', fullWidth: true, loading: _busy, onPressed: _save),
      ],
    );
  }
}
