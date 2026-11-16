import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/api.dart';
import '../../../core/format.dart';
import '../../../core/links.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../../follow_ups/presentation/follow_up_row.dart';
import '../../home/data/home_data.dart';
import '../data/sales_data.dart';
import '../domain/sales_terms.dart';
import '../../follow_ups/presentation/follow_up_form.dart';
import 'quotation_card.dart';

/// One inquiry: who and what, where it stands, the quotation in its two views, what is
/// planned, and the notes. Putting on hold, losing and reopening are a tap away.
class InquiryScreen extends ConsumerWidget {
  const InquiryScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inquiry = ref.watch(inquiryProvider(id));
    final api = ref.watch(sessionProvider.notifier).api;
    void reload() {
      ref.invalidate(inquiryProvider(id));
      ref.invalidate(quotationProvider(id));
      ref.invalidate(inquiryFollowUpsProvider(id));
      ref.invalidate(inquiriesProvider);
    }

    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: KTopBar(
        title: 'Inquiry',
        actions: [
          if (inquiry.value != null)
            KIconButton(
              KIcons.more,
              label: 'More actions',
              onPressed: () => _actions(context, api, inquiry.value!, reload),
            ),
        ],
      ),
      body: switch (inquiry) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: () async => reload(),
          child: _Body(i: value, api: api, onChanged: reload),
        ),
        AsyncValue(:final error?) => Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: KBanner(
            error.toString(),
            tone: KTone.danger,
            title: "Couldn't open this inquiry",
            actionLabel: 'Try again',
            onAction: reload,
          ),
        ),
        _ => const Padding(
          padding: EdgeInsets.all(KSpace.s4),
          child: Column(
            children: [
              KSkeleton(height: 160),
              SizedBox(height: KSpace.s4),
              KSkeleton(height: 120),
            ],
          ),
        ),
      },
    );
  }

  Future<void> _actions(BuildContext context, Api api, Inquiry i, VoidCallback reload) async {
    final open = Stage.isOpen(i.stage);
    final pick = await showKSheet<String>(
      context,
      title: i.refNo,
      builder: (ctx) => Column(
        children: [
          if (open)
            KListItem(
              leading: KIcon(i.onHold ? KIcons.play : KIcons.clock, color: ctx.k.inkMuted),
              title: i.onHold ? 'Take off hold' : 'Put on hold',
              subtitle: i.onHold ? 'Back in the open list and reminders' : 'Waiting on the customer; reminders pause',
              chevron: false,
              onPressed: () => Navigator.pop(ctx, 'hold'),
            ),
          if (open)
            KListItem(
              leading: KIcon(KIcons.close, color: ctx.k.danger),
              title: 'Mark as lost',
              subtitle: 'Say why, so the reports can learn from it',
              chevron: false,
              onPressed: () => Navigator.pop(ctx, 'lost'),
            ),
          if (i.stage == 'lost')
            KListItem(
              leading: KIcon(KIcons.refresh, color: ctx.k.inkMuted),
              title: 'Reopen',
              chevron: false,
              onPressed: () => Navigator.pop(ctx, 'reopen'),
            ),
          KListItem(
            leading: KIcon(KIcons.globe, color: ctx.k.inkMuted),
            title: 'Open on the web',
            subtitle: 'Factory prices and the quotation editor',
            divider: false,
            chevron: false,
            onPressed: () => Navigator.pop(ctx, 'web'),
          ),
        ],
      ),
    );
    if (!context.mounted || pick == null) return;
    final act = InquiryActions(api);
    try {
      switch (pick) {
        case 'hold':
          await act.hold(i.id, !i.onHold);
          if (context.mounted) showKToast(context, i.onHold ? 'Taken off hold' : 'Put on hold');
        case 'reopen':
          await act.move(i.id, 'new');
          if (context.mounted) showKToast(context, 'Reopened');
        case 'lost':
          final done = await showKSheet<bool>(
            context,
            title: 'Mark ${i.refNo} as lost',
            builder: (_) => _LostForm(i: i, act: act),
          );
          if (done != true) return;
          if (context.mounted) showKToast(context, 'Marked as lost');
        case 'web':
          await openLink(context, api, '/inquiries/${i.id}');
          return;
      }
      reload();
    } on ApiException catch (e) {
      if (context.mounted) showKToast(context, e.message, icon: KIcons.error);
    }
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.i, required this.api, required this.onChanged});
  final Inquiry i;
  final Api api;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.k;
    final quote = ref.watch(quotationProvider(i.id));
    final followUps = ref.watch(inquiryFollowUpsProvider(i.id));
    final stage = i.stage;
    KStepState st(String s) {
      const order = ['new', 'sourcing', 'quoted', 'won'];
      if (stage == 'lost') return s == 'new' ? KStepState.done : KStepState.todo;
      final at = order.indexOf(stage ?? 'new'), me = order.indexOf(s);
      return me < at || stage == 'won'
          ? KStepState.done
          : me == at
          ? (i.onHold ? KStepState.blocked : KStepState.current)
          : KStepState.todo;
    }

    final last = i.lastChange;
    final phone = i.contactPhone;
    final email = i.contactEmail;
    return ListView(
      padding: const EdgeInsets.only(bottom: KSpace.s16),
      children: [
        KRecordHeader(
          type: 'Inquiry',
          number: i.refNo,
          icon: KIcons.chart,
          title: i.what,
          party: [i.customer, i.country].whereType<String>().join(' · '),
          badges: [
            Stage.badge(stage),
            if (i.overdue) const KBadge('Overdue', tone: KTone.danger),
            if (i.onHold) const KBadge('On hold', tone: KTone.warning),
            if (i.priority != 'normal')
              KBadge(
                Priority.labels[i.priority] ?? i.priority,
                tone: i.priority == 'urgent' ? KTone.danger : KTone.neutral,
              ),
          ],
          figures: [
            KFigure('Items', '${i.items.length}'),
            if (i.quoteTotal != null) KFigure('Quoted', fmtMoney(i.quoteTotal, i.quoteCurrency) ?? ''),
            KFigure(
              'Needed by',
              i.requiredBy == null ? 'Not set' : fmtDate(DateTime.tryParse(i.requiredBy!)) ?? '',
              tone: i.overdue ? KTone.danger : null,
            ),
          ],
          steps: KSteps(
            steps: [
              ('New', st('new')),
              ('Getting prices', st('sourcing')),
              ('Quoted', st('quoted')),
              ('Won', st('won')),
            ],
          ),
          actions: [
            if (phone != null)
              KButton(
                'Call',
                fullWidth: true,
                icon: KIcons.phone,
                variant: KButtonVariant.secondary,
                onPressed: () => launchUrl(Uri.parse('tel:$phone')),
              ),
            if (phone != null)
              KButton(
                'Chat',
                fullWidth: true,
                icon: KIcons.chat,
                variant: KButtonVariant.secondary,
                onPressed: () => launchUrl(
                  Uri.parse('https://wa.me/${phone.replaceAll(RegExp(r'[^0-9]'), '')}'),
                  mode: LaunchMode.externalApplication,
                ),
              ),
            if (email != null)
              KButton(
                'Mail',
                fullWidth: true,
                icon: KIcons.mail,
                variant: KButtonVariant.secondary,
                onPressed: () => launchUrl(Uri.parse('mailto:$email?subject=${Uri.encodeComponent(i.refNo)}')),
              ),
          ],
          updated: last == null
              ? (i.createdAt == null
                    ? null
                    : 'Received ${fmtDate(i.createdAt)}${i.assignee == null ? '' : ' · handled by ${i.assignee}'}')
              : 'Moved to ${Stage.label(last['toStage'] as String?)} ${fmtDate(DateTime.tryParse('${last['changedAt']}'))}${i.assignee == null ? '' : ' · handled by ${i.assignee}'}',
        ),
        Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (stage == 'lost') ...[
                KBanner(
                  [LostReason.labels[i.lostReason] ?? 'Lost', if (i.lostNote != null) i.lostNote!].join('. '),
                  tone: KTone.warning,
                  title: 'Lost',
                ),
                const SizedBox(height: KSpace.s4),
              ],
              if (stage == 'won' && i.orderRef != null) ...[
                KBanner('This deal became order ${i.orderRef}.', tone: KTone.success, title: 'Won'),
                const SizedBox(height: KSpace.s4),
              ],
              KDetails(
                title: 'Details',
                items: [
                  KDetail('Customer', i.customer),
                  KDetail('Contact', i.contact),
                  KDetail('Category', i.category),
                  KDetail('Came by', Channel.labels[i.channel] ?? i.channel),
                  KDetail('Priority', Priority.labels[i.priority]),
                  KDetail('Needed by', i.requiredBy == null ? null : fmtDate(DateTime.tryParse(i.requiredBy!))),
                  KDetail('Handled by', i.assignee),
                  KDetail('Received', fmtDate(i.createdAt)),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'What they need',
                children: [
                  KCard(
                    child: Text(
                      i.requirements ?? 'Not written. The items below are the request.',
                      style: KType.body.copyWith(color: i.requirements == null ? c.inkMuted : c.ink),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Items',
                caption: i.items.isEmpty ? null : '${i.items.length} requested',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: i.items.isEmpty
                        ? const KEmptyState(
                            icon: KIcons.box,
                            title: 'No items yet',
                            message: 'The lines are made when factory prices come in.',
                          )
                        : Column(
                            children: [
                              for (final (n, it) in i.items.indexed)
                                KListItem(
                                  leading: SizedBox(
                                    width: 28,
                                    child: Text(it.no ?? '${n + 1}', style: KType.label.copyWith(color: c.inkMuted)),
                                  ),
                                  title: it.description,
                                  subtitle: [
                                    if (it.model != null) 'Model ${it.model}',
                                    '${it.quantity} ${it.unit}',
                                    if (it.targetPrice != null) 'target ${fmtMoney(it.targetPrice, null)}',
                                  ].join(' · '),
                                  divider: n < i.items.length - 1,
                                ),
                            ],
                          ),
                  ),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Quotation',
                children: [
                  switch (quote) {
                    AsyncValue(:final value?) when value.revisions.isNotEmpty => QuotationCard(
                      refNo: value.refNo,
                      revision: value.revisions.first,
                      revisionCount: value.revisions.length,
                    ),
                    AsyncValue(:final value?) => KCard(
                      child: KEmptyState(
                        icon: KIcons.file,
                        title: 'Not quoted yet',
                        message: value.whyNotStart ?? 'Make the quotation on the web, from the factory offers. It shows here as soon as it is saved.',
                      ),
                    ),
                    AsyncValue(:final error?) => KBanner(error.toString(), tone: KTone.danger),
                    _ => const KSkeleton(height: 120),
                  },
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Follow-ups',
                actionLabel: 'Plan',
                onAction: () async {
                  if (await openFollowUpForm(context, target: ('inquiryId', i.id), about: '${i.refNo} · ${i.what}')) {
                    onChanged();
                  }
                },
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: switch (followUps) {
                      AsyncValue(:final value?) when value.where((f) => f['done'] != true).isEmpty => const KEmptyState(
                        icon: KIcons.calendar,
                        title: 'Nothing planned',
                        message: 'An open inquiry should always have a next step. Plan one with Plan.',
                      ),
                      AsyncValue(:final value?) => Column(
                        children: [
                          for (final (n, f) in value.where((f) => f['done'] != true).indexed)
                            FollowUpRow(
                              f: FollowUp.fromJson(f),
                              api: api,
                              divider: n < value.length - 1,
                              onChanged: onChanged,
                              onOpen: () async {
                                if (await openFollowUpForm(context, existing: f)) onChanged();
                              },
                            ),
                        ],
                      ),
                      _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 48)),
                    },
                  ),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              _Notes(i: i, api: api, onChanged: onChanged),
            ],
          ),
        ),
      ],
    );
  }
}

class _Notes extends StatefulWidget {
  const _Notes({required this.i, required this.api, required this.onChanged});
  final Inquiry i;
  final Api api;
  final VoidCallback onChanged;

  @override
  State<_Notes> createState() => _NotesState();
}

class _NotesState extends State<_Notes> {
  final _ctl = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    if (_ctl.text.trim().isEmpty) {
      setState(() => _error = 'Write a note first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await InquiryActions(widget.api).note(widget.i.id, _ctl.text.trim());
      _ctl.clear();
      KHaptics.success();
      widget.onChanged();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final notes = widget.i.notes.reversed.toList();
    return KSection(
      title: 'Notes',
      caption: notes.isEmpty ? null : '${notes.length}',
      children: [
        KTextField(
          label: 'Add a note',
          controller: _ctl,
          multiline: true,
          hint: 'What was said, decided or promised',
          error: _error,
          enabled: !_busy,
        ),
        const SizedBox(height: KSpace.s2),
        Align(
          alignment: Alignment.centerRight,
          child: KButton('Add note', variant: KButtonVariant.secondary, loading: _busy, onPressed: _add),
        ),
        const SizedBox(height: KSpace.s3),
        for (final n in notes)
          Padding(
            padding: const EdgeInsets.only(bottom: KSpace.s2),
            child: KCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(n.body, style: KType.body.copyWith(color: c.ink)),
                  const SizedBox(height: KSpace.s1),
                  Text(
                    [n.author, fmtDateTime(n.at)].whereType<String>().join(' · '),
                    style: KType.footnote.copyWith(color: c.inkMuted),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Why it was lost: required, so the reports can learn from it.
class _LostForm extends StatefulWidget {
  const _LostForm({required this.i, required this.act});
  final Inquiry i;
  final InquiryActions act;

  @override
  State<_LostForm> createState() => _LostFormState();
}

class _LostFormState extends State<_LostForm> {
  String? _reason;
  final _note = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_reason == null) {
      KHaptics.error();
      setState(() => _error = 'Choose why it was lost.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.act.move(widget.i.id, 'lost', lostReason: _reason, note: _note.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
      Text('Why was it lost?', style: KType.label.copyWith(color: context.k.ink)),
      for (final e in LostReason.labels.entries)
        KRadio<String>(label: e.value, value: e.key, group: _reason, onChanged: (v) => setState(() => _reason = v)),
      const SizedBox(height: KSpace.s3),
      KTextField(label: 'Note', controller: _note, optional: true, multiline: true),
      const SizedBox(height: KSpace.s5),
      KButton('Mark as lost', variant: KButtonVariant.danger, fullWidth: true, loading: _busy, onPressed: _save),
    ],
  );
}
