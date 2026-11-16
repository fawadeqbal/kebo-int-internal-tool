import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/pick_sheet.dart';
import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../data/sales_data.dart';
import '../domain/sales_terms.dart';

/// A new inquiry in three short steps and a review: who asked, what they need, their items
/// (optional), then everything at once before it is saved.
class NewInquiryScreen extends ConsumerStatefulWidget {
  const NewInquiryScreen({super.key});

  @override
  ConsumerState<NewInquiryScreen> createState() => _NewInquiryScreenState();
}

class _Line {
  _Line(this.description, this.quantity, this.unit, {this.model});
  String description, quantity, unit;
  String? model;
  Json toJson() => {'description': description, 'model': ?model, 'quantity': quantity, 'unit': unit};
}

class _NewInquiryScreenState extends ConsumerState<NewInquiryScreen> {
  Choice? _customer;
  String _channel = 'email';
  String? _category;
  final _title = TextEditingController();
  final _needs = TextEditingController();
  String _priority = 'normal';
  DateTime? _by;
  final _lines = <_Line>[];
  String? _createdId;
  Map<String, String> _fields = const {};

  @override
  void dispose() {
    _title.dispose();
    _needs.dispose();
    super.dispose();
  }

  Future<void> _pickCustomer() async {
    final all = await ref.read(customerNamesProvider.future).catchError((Object _) => <Choice>[]);
    if (!mounted) return;
    final c = await showPickSheet(
      context,
      title: 'Customer',
      choices: all,
      selectedId: _customer?.id,
      hint: 'Search customers',
    );
    if (c != null) setState(() => _customer = c);
  }

  Future<void> _pickCategory() async {
    final s = await ref.read(salesSettingsProvider.future).catchError((Object _) => <String, dynamic>{});
    final cats = [
      for (final c in (s['categories'] as List<dynamic>? ?? const []))
        if (c is String)
          Choice(c, c)
        else if (c is Map)
          Choice('${c['name'] ?? c['label']}', '${c['name'] ?? c['label']}'),
    ];
    if (!mounted) return;
    final c = await showPickSheet(context, title: 'Category', choices: cats, selectedId: _category);
    if (c != null) setState(() => _category = c.name);
  }

  Future<void> _addLine([int? at]) async {
    final line = await showKSheet<_Line>(
      context,
      title: at == null ? 'Add an item' : 'Edit item',
      builder: (_) => _LineForm(line: at == null ? null : _lines[at]),
    );
    if (line == null) return;
    setState(() => at == null ? _lines.add(line) : _lines[at] = line);
  }

  Future<void> _save() async {
    final api = ref.read(sessionProvider.notifier).api;
    try {
      final id = await InquiryActions(api).create({
        'customerId': _customer?.id,
        'channel': _channel,
        'category': _category,
        if (_title.text.trim().isNotEmpty) 'title': _title.text.trim(),
        if (_needs.text.trim().isNotEmpty) 'requirements': _needs.text.trim(),
        'priority': _priority,
        'requiredBy': ?isoDay(_by),
        'items': [for (final l in _lines) l.toJson()],
      });
      ref.invalidate(inquiriesProvider);
      setState(() => _createdId = id);
    } on ApiException catch (e) {
      setState(() => _fields = e.fieldErrors);
      if (mounted) {
        showKToast(context, e.fieldErrors.isEmpty ? e.message : 'Check the marked fields.', icon: KIcons.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Scaffold(
      backgroundColor: c.bg,
      appBar: KTopBar(
        title: 'New inquiry',
        leading: KTopBarLeading.close,
        onLeading: () async {
          final dirty = _customer != null || _needs.text.isNotEmpty || _lines.isNotEmpty;
          final leave =
              !dirty ||
              _createdId != null ||
              await showKConfirm(
                    context,
                    title: 'Discard this inquiry?',
                    message: 'What you entered will be lost.',
                    confirmLabel: 'Discard',
                    destructive: true,
                  ) ==
                  true;
          if (leave && context.mounted) context.pop();
        },
      ),
      body: _createdId != null
          ? Center(
              child: SuccessCheck(
                label: 'Inquiry saved',
                onDone: () => context.pushReplacement('/sales/inquiry/$_createdId'),
              ),
            )
          : KStepForm(
              submitLabel: 'Save inquiry',
              onSubmit: _save,
              steps: [
                KFormStep(
                  title: 'Who asked',
                  validate: () => _customer == null ? 'Choose the customer.' : null,
                  builder: (_) => Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      KSelectField(
                        label: 'Customer',
                        value: _customer?.name,
                        placeholder: 'Choose a customer',
                        icon: KIcons.search,
                        onTap: _pickCustomer,
                        error: _fields['customerId'],
                      ),
                      const SizedBox(height: KSpace.s5),
                      Text('It came by', style: KType.label.copyWith(color: c.ink)),
                      const SizedBox(height: KSpace.s2),
                      Wrap(
                        spacing: KSpace.s2,
                        runSpacing: KSpace.s2,
                        children: [
                          for (final e in Channel.labels.entries.where((e) => e.key != 'website'))
                            KChip(
                              e.value,
                              selected: _channel == e.key,
                              onPressed: () => setState(() => _channel = e.key),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                KFormStep(
                  title: 'What they need',
                  validate: () => _category == null
                      ? 'Choose a category.'
                      : (_needs.text.trim().isEmpty && _lines.isEmpty
                            ? 'Write what the customer needs (or add their items in the next step).'
                            : null),
                  builder: (_) => Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      KSelectField(
                        label: 'Category',
                        value: _category,
                        placeholder: 'Choose a category',
                        onTap: _pickCategory,
                        error: _fields['category'],
                      ),
                      const SizedBox(height: KSpace.s4),
                      KTextField(
                        label: 'Title',
                        controller: _title,
                        optional: true,
                        hint: 'Tablet press, 35 stations',
                        help: 'A few words to find it by.',
                      ),
                      const SizedBox(height: KSpace.s4),
                      KTextField(
                        label: 'Requirements',
                        controller: _needs,
                        multiline: true,
                        hint: 'Capacity, materials, standards, voltage…',
                        error: _fields['requirements'],
                      ),
                      const SizedBox(height: KSpace.s4),
                      Text('Priority', style: KType.label.copyWith(color: c.ink)),
                      const SizedBox(height: KSpace.s2),
                      KSegmented<String>(
                        value: _priority,
                        onChanged: (v) => setState(() => _priority = v),
                        segments: [for (final e in Priority.labels.entries) (e.key, e.value)],
                      ),
                      const SizedBox(height: KSpace.s4),
                      KSelectField(
                        label: 'Needed by',
                        optional: true,
                        placeholder: 'Choose a day',
                        value: fmtDate(_by),
                        icon: KIcons.calendar,
                        onTap: () async {
                          final d = await showDatePicker(
                            context: context,
                            initialDate: _by ?? CompanyTime.today().add(const Duration(days: 30)),
                            firstDate: CompanyTime.today(),
                            lastDate: CompanyTime.today().add(const Duration(days: 730)),
                          );
                          if (d != null) setState(() => _by = d);
                        },
                      ),
                    ],
                  ),
                ),
                KFormStep(
                  title: 'Their items',
                  builder: (_) => Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Optional. Often the customer sends only requirements; the lines are made at factory prices.',
                        style: KType.callout.copyWith(color: c.inkMuted),
                      ),
                      const SizedBox(height: KSpace.s3),
                      if (_lines.isNotEmpty)
                        KCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              for (final (n, l) in _lines.indexed)
                                KListItem(
                                  leading: SizedBox(
                                    width: 24,
                                    child: Text('${n + 1}', style: KType.label.copyWith(color: c.inkMuted)),
                                  ),
                                  title: l.description,
                                  subtitle: [
                                    if (l.model != null) 'Model ${l.model}',
                                    '${l.quantity} ${l.unit}',
                                  ].join(' · '),
                                  divider: n < _lines.length - 1,
                                  onPressed: () => _addLine(n),
                                  trailing: KIconButton(
                                    KIcons.trash,
                                    label: 'Remove ${l.description}',
                                    onPressed: () => setState(() => _lines.removeAt(n)),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      const SizedBox(height: KSpace.s3),
                      KButton(
                        'Add an item',
                        icon: KIcons.plus,
                        variant: KButtonVariant.secondary,
                        fullWidth: true,
                        onPressed: _addLine,
                      ),
                    ],
                  ),
                ),
              ],
              review: (ctx, goTo) => Column(
                children: [
                  KDetails(
                    title: 'Who asked',
                    onEdit: () => goTo(0),
                    items: [KDetail('Customer', _customer?.name), KDetail('Came by', Channel.labels[_channel])],
                  ),
                  const SizedBox(height: KSpace.s3),
                  KDetails(
                    title: 'What they need',
                    columns: 1,
                    onEdit: () => goTo(1),
                    items: [
                      KDetail('Category', _category),
                      KDetail('Title', _title.text),
                      KDetail('Requirements', _needs.text),
                      KDetail('Priority', Priority.labels[_priority]),
                      KDetail('Needed by', fmtDate(_by)),
                    ],
                  ),
                  const SizedBox(height: KSpace.s3),
                  KDetails(
                    title: 'Items',
                    columns: 1,
                    onEdit: () => goTo(2),
                    items: [
                      KDetail(
                        'Lines',
                        _lines.isEmpty
                            ? null
                            : _lines.map((l) => '${l.quantity} ${l.unit}  ${l.description}').join('\n'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
    );
  }
}

class _LineForm extends StatefulWidget {
  const _LineForm({this.line});
  final _Line? line;

  @override
  State<_LineForm> createState() => _LineFormState();
}

class _LineFormState extends State<_LineForm> {
  late final _desc = TextEditingController(text: widget.line?.description);
  late final _model = TextEditingController(text: widget.line?.model);
  late final _qty = TextEditingController(text: widget.line?.quantity ?? '1');
  late final _unit = TextEditingController(text: widget.line?.unit ?? 'pcs');
  String? _error;

  @override
  void dispose() {
    for (final c in [_desc, _model, _qty, _unit]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      KTextField(label: 'Description', controller: _desc, multiline: true, error: _error),
      const SizedBox(height: KSpace.s4),
      KTextField(label: 'Model', controller: _model, optional: true),
      const SizedBox(height: KSpace.s4),
      Row(
        children: [
          Expanded(
            flex: 2,
            child: KTextField(
              label: 'Quantity',
              controller: _qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
          ),
          const SizedBox(width: KSpace.s3),
          Expanded(
            child: KTextField(label: 'Unit', controller: _unit),
          ),
        ],
      ),
      const SizedBox(height: KSpace.s5),
      KButton(
        widget.line == null ? 'Add item' : 'Save item',
        fullWidth: true,
        onPressed: () {
          if (_desc.text.trim().isEmpty) {
            setState(() => _error = 'Each item needs a description.');
            return;
          }
          Navigator.of(context).pop(
            _Line(
              _desc.text.trim(),
              _qty.text.trim().isEmpty ? '1' : _qty.text.trim(),
              _unit.text.trim().isEmpty ? 'pcs' : _unit.text.trim(),
              model: _model.text.trim().isEmpty ? null : _model.text.trim(),
            ),
          );
        },
      ),
    ],
  );
}
