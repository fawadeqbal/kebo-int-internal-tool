import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../design/design.dart';

/// Gallery, page 2: the step-2 components, with real RFQ Desk content, so each one can be
/// reviewed on a phone in context.
class PatternsScreen extends StatefulWidget {
  const PatternsScreen({super.key});

  @override
  State<PatternsScreen> createState() => _PatternsScreenState();
}

enum _View { internal, customer }

class _PatternsScreenState extends State<PatternsScreen> {
  int _tab = 0;
  bool _bank = true;
  bool _notify = true;
  String _method = 'Bank transfer';
  _View _view = _View.internal;
  final _filters = {'Open': true, 'Needs prices': false, 'Overdue': false};
  final _files = <KFileItem>[
    const KFileItem(name: 'payment-slip-HBL.jpg', bytes: 1840000),
    const KFileItem(name: 'swift-copy.pdf', bytes: 312000, progress: 0.62),
    const KFileItem(name: 'bank-letter.pdf', bytes: 26214400 + 1, error: 'Over the 25 MB limit (25.0 MB)'),
  ];

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Scaffold(
      backgroundColor: c.bg,
      bottomNavigationBar: KTabBar(
        index: _tab,
        onSelect: (i) => setState(() => _tab = i),
        tabs: const [
          KTab('Home', KIcons.home),
          KTab('Sales', KIcons.chart, badge: 3),
          KTab('Orders', KIcons.box),
          KTab('Money', KIcons.wallet),
          KTab('More', KIcons.grid),
        ],
      ),
      floatingActionButton: KFab(icon: KIcons.plus, semanticLabel: 'New inquiry', label: 'Inquiry', onPressed: () {}),
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: KAppHeader(
              brand: true,
              company: 'Kebo International',
              title: greeting(DateTime.now(), 'Fawad'),
              eyebrow: 'Monday 16 November',
              summary: '12 open inquiries · 3 need supplier prices',
              sync: const KSyncState.synced('9:41'),
              userName: 'Fawad Iqbal',
              userRole: 'Owner',
              unread: 4,
              onBell: () {},
              onSearch: () {},
              onAccount: () => context.pop(),
            ),
          ),
          const SliverToBoxAdapter(
            child: KAppHeader(
              company: 'Kebo International',
              title: 'Orders',
              summary: '8 in progress · 2 waiting for documents',
              sync: KSyncState.offline('8:42'),
              userName: 'Fawad Iqbal',
              userRole: 'Owner',
            ),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: KSpace.s3)),
          const SliverToBoxAdapter(
            child: KRecordHeader(
              type: 'Sales order',
              number: 'SO-2026-0035',
              icon: KIcons.box,
              title: 'Tablet press, 35 stations',
              party: 'Kabul Medical Supplies',
              badges: [
                KBadge('Shipped', tone: KTone.info),
                KBadge('Bank contract'),
              ],
              figures: [
                KFigure('Total', 'USD 48,200'),
                KFigure('Received', 'USD 28,920', tone: KTone.success),
                KFigure('ETA', '2 Dec'),
              ],
              steps: KSteps(
                steps: [
                  ('Confirmed', KStepState.done),
                  ('Production', KStepState.done),
                  ('Shipped', KStepState.done),
                  ('Customs', KStepState.current),
                  ('Delivered', KStepState.todo),
                  ('SAT', KStepState.todo),
                ],
              ),
              updated: 'Updated 8 Nov by Bilal · departed Qingdao',
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(KSpace.s4),
            sliver: SliverList.list(
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: KStatTile(
                        label: 'To collect',
                        value: 'USD 19,280',
                        delta: '2 overdue',
                        deltaTone: KTone.danger,
                        icon: KIcons.arrowIn,
                      ),
                    ),
                    const SizedBox(width: KSpace.s3),
                    Expanded(
                      child: KStatTile(
                        label: 'Won this month',
                        value: '4',
                        delta: '+2 on October',
                        deltaTone: KTone.success,
                        onPressed: () {},
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Document view',
                  caption: 'One document, two audiences',
                  children: [
                    KSegmented<_View>(
                      value: _view,
                      onChanged: (v) => setState(() => _view = v),
                      segments: const [(_View.internal, 'Internal'), (_View.customer, 'Customer')],
                    ),
                    const SizedBox(height: KSpace.s3),
                    KDetails(
                      title: 'Quotation QT-2026-0112',
                      onEdit: () {},
                      items: [
                        const KDetail('Customer', 'Kabul Medical Supplies'),
                        const KDetail('Valid until', '30 Nov 2026'),
                        const KDetail('Price (CIF Karachi)', 'USD 48,200', emphasis: true),
                        const KDetail('Payment terms', '30% deposit, 70% against B/L'),
                        if (_view == _View.internal) ...const [
                          KDetail('Supplier cost', 'USD 39,600', internal: true),
                          KDetail('Margin', '17.8%', internal: true),
                        ],
                        const KDetail('Customer reference', null),
                        const KDetail('Warranty', '12 months'),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Lists',
                  actionLabel: 'See all',
                  onAction: () {},
                  children: [
                    Wrap(
                      spacing: KSpace.s2,
                      runSpacing: KSpace.s2,
                      children: [
                        for (final e in _filters.entries)
                          KChip(
                            e.key,
                            selected: e.value,
                            count: e.key == 'Open' ? 12 : null,
                            onPressed: () => setState(() => _filters[e.key] = !e.value),
                          ),
                      ],
                    ),
                    const SizedBox(height: KSpace.s3),
                    const KSearchField(hint: 'Search inquiries, customers, products'),
                    const SizedBox(height: KSpace.s3),
                    KCard(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          KListItem(
                            leading: const KAvatar('Kabul Medical Supplies'),
                            title: 'Kabul Medical Supplies',
                            subtitle: 'Tablet press, 35 stations · 2 items',
                            meta: 'INQ-2026-0218 · 2 days ago',
                            status: const KBadge('Needs prices', tone: KTone.warning),
                            onPressed: () {},
                          ),
                          KListItem(
                            leading: const KAvatar('Herat Pharma'),
                            title: 'Herat Pharma',
                            subtitle: 'Blister packing line',
                            meta: 'INQ-2026-0215 · 5 days ago',
                            status: const KBadge('Quoted', tone: KTone.info),
                            onPressed: () {},
                            divider: false,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: KSpace.s3),
                    const KCard(
                      child: KEmptyState(
                        icon: KIcons.file,
                        title: 'No documents yet',
                        message: 'The bank needs the B/L and certificate of origin before it releases the balance.',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Forms',
                  children: [
                    const KTextField(
                      label: 'Amount',
                      prefix: 'USD',
                      hint: '0.00',
                      keyboardType: TextInputType.number,
                      help: 'What the customer sent, before bank charges.',
                    ),
                    const SizedBox(height: KSpace.s4),
                    const KTextField(label: 'Bank reference', error: 'This reference is already on PAY-2026-0091.'),
                    const SizedBox(height: KSpace.s4),
                    KSelectField(label: 'Received on', value: '16 Nov 2026', icon: KIcons.calendar, onTap: () {}),
                    const SizedBox(height: KSpace.s4),
                    const KTextField(
                      label: 'Note',
                      optional: true,
                      multiline: true,
                      hint: 'Anything the verifier should know',
                    ),
                    const SizedBox(height: KSpace.s3),
                    for (final m in ['Bank transfer', 'Cash', 'Cheque'])
                      KRadio<String>(label: m, value: m, group: _method, onChanged: (v) => setState(() => _method = v)),
                    KCheckbox(
                      label: 'Received into the bank-contract account',
                      value: _bank,
                      onChanged: (v) => setState(() => _bank = v),
                    ),
                    KSwitch(
                      label: 'Tell the customer by email',
                      help: 'Sends the receipt when verified',
                      value: _notify,
                      onChanged: (v) => setState(() => _notify = v),
                    ),
                    const SizedBox(height: KSpace.s3),
                    KFileField(
                      label: 'Payment proof',
                      help: 'Verifiers need it. A photo of the slip is enough.',
                      multiple: true,
                      files: _files,
                      onTakePhoto: () {},
                      onChooseFile: () {},
                      onRetry: (_) {},
                      onRemove: (i) => setState(() => _files.removeAt(i)),
                    ),
                  ],
                ),
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Overlays',
                  children: [
                    Wrap(
                      spacing: KSpace.s2,
                      runSpacing: KSpace.s2,
                      children: [
                        KButton('Sheet', variant: KButtonVariant.secondary, onPressed: () => _sheet(context)),
                        KButton('Dialog', variant: KButtonVariant.secondary, onPressed: () => _dialog(context)),
                        KButton(
                          'Toast + Undo',
                          variant: KButtonVariant.secondary,
                          onPressed: () => showKToast(
                            context,
                            'Expense deleted',
                            icon: KIcons.trash,
                            actionLabel: 'Undo',
                            onAction: () {},
                          ),
                        ),
                        KButton(
                          'Stepped form',
                          variant: KButtonVariant.secondary,
                          onPressed: () => context.push('/gallery/form'),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 96),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _sheet(BuildContext context) {
    var pick = 'Newest first';
    showKSheet<void>(
      context,
      title: 'Sort inquiries',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Column(
          children: [
            for (final o in ['Newest first', 'Oldest first', 'Customer A–Z', 'Biggest value'])
              KRadio<String>(label: o, value: o, group: pick, onChanged: (v) => set(() => pick = v)),
          ],
        ),
      ),
      footer: KButton('Apply', fullWidth: true, onPressed: () => Navigator.of(context).pop()),
    );
  }

  Future<void> _dialog(BuildContext context) async {
    final ok = await showKConfirm(
      context,
      title: 'Cancel order SO-2026-0035?',
      message: 'USD 28,920 was received. Cancelling starts a refund and tells the supplier to stop.',
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
      destructive: true,
    );
    if (ok == true && context.mounted) showKToast(context, 'Order cancelled');
  }
}

/// Gallery: a long form (record a payment) split into steps, with review.
class StepFormDemo extends StatefulWidget {
  const StepFormDemo({super.key});

  @override
  State<StepFormDemo> createState() => _StepFormDemoState();
}

class _StepFormDemoState extends State<StepFormDemo> {
  final _amount = TextEditingController();
  final _ref = TextEditingController();
  bool _done = false;

  @override
  void dispose() {
    _amount.dispose();
    _ref.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const KTopBar(title: 'Record payment', leading: KTopBarLeading.close),
      body: _done
          ? const Center(child: SuccessCheck(label: 'Payment sent for verification'))
          : KStepForm(
              submitLabel: 'Send for verification',
              onSubmit: () async {
                await Future<void>.delayed(const Duration(milliseconds: 900));
                setState(() => _done = true);
              },
              steps: [
                KFormStep(
                  title: 'Paid by',
                  builder: (_) => Column(
                    children: [
                      KSelectField(label: 'Customer', value: 'Kabul Medical Supplies', onTap: () {}),
                      const SizedBox(height: KSpace.s4),
                      KSelectField(label: 'For order', value: 'SO-2026-0035 · Tablet press', onTap: () {}),
                    ],
                  ),
                ),
                KFormStep(
                  title: 'Amount',
                  validate: () => _amount.text.trim().isEmpty ? 'Enter the amount received.' : null,
                  builder: (_) => Column(
                    children: [
                      KTextField(
                        label: 'Amount',
                        controller: _amount,
                        prefix: 'USD',
                        keyboardType: TextInputType.number,
                      ),
                      const SizedBox(height: KSpace.s4),
                      KTextField(label: 'Bank reference', controller: _ref, optional: true),
                    ],
                  ),
                ),
                KFormStep(
                  title: 'Proof',
                  builder: (_) => KFileField(
                    label: 'Payment proof',
                    help: 'Verifiers need it.',
                    files: const [],
                    onTakePhoto: () {},
                    onChooseFile: () {},
                  ),
                ),
              ],
              review: (ctx, goTo) => Column(
                children: [
                  KDetails(
                    title: 'Paid by',
                    onEdit: () => goTo(0),
                    items: const [KDetail('Customer', 'Kabul Medical Supplies'), KDetail('Order', 'SO-2026-0035')],
                  ),
                  const SizedBox(height: KSpace.s3),
                  KDetails(
                    title: 'Amount',
                    onEdit: () => goTo(1),
                    items: [
                      KDetail('Amount', _amount.text.isEmpty ? null : 'USD ${_amount.text}'),
                      KDetail('Bank reference', _ref.text),
                    ],
                  ),
                  const SizedBox(height: KSpace.s3),
                  KDetails(
                    title: 'Proof',
                    onEdit: () => goTo(2),
                    columns: 1,
                    items: const [KDetail('Payment proof', null)],
                  ),
                ],
              ),
            ),
    );
  }
}
