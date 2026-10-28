import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../customers/customers.dart';

/// Units offered on every item (any short text works too). Same list as the web.
const kUnits = ['pcs', 'set', 'unit', 'lot', 'kg', 'ton', 'm', 'm²', 'm³', 'L', 'carton', 'roll', 'pair'];

/// One requested item being typed.
class ItemDraft {
  final description = TextEditingController();
  final model = TextEditingController();
  final quantity = TextEditingController(text: '1');
  final unit = TextEditingController(text: 'pcs');
  final targetPrice = TextEditingController();

  bool get isEmpty => description.text.trim().isEmpty;

  Json toJson() => {
        'description': description.text.trim(),
        if (model.text.trim().isNotEmpty) 'model': model.text.trim(),
        'quantity': quantity.text.trim(),
        'unit': unit.text.trim().isEmpty ? 'pcs' : unit.text.trim(),
        if (targetPrice.text.trim().isNotEmpty) 'targetPrice': targetPrice.text.trim(),
      };

  void dispose() {
    for (final c in [description, model, quantity, unit, targetPrice]) {
      c.dispose();
    }
  }
}

/// New deal: customer (search), contact, how it came in, category, items, priority, needed-by, who handles it.
/// Editing a deal, factory prices and quotations are done on the web.
class DealFormScreen extends ConsumerStatefulWidget {
  const DealFormScreen({super.key, this.customerId});
  final String? customerId;
  @override
  ConsumerState<DealFormScreen> createState() => _DealFormScreenState();
}

const _other = '__other__';

class _DealFormScreenState extends ConsumerState<DealFormScreen> {
  Json? _customer;
  List<Json> _contacts = const [];
  String? _contactId;
  String _channel = 'whatsapp';
  String _category = '';
  final _customCategory = TextEditingController();
  final _items = <ItemDraft>[ItemDraft()];
  final _title = TextEditingController();
  final _requirements = TextEditingController();
  String _priority = 'normal';
  String _requiredBy = '';
  String _assignee = '';
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    final session = ref.read(sessionProvider);
    // Staff handle what they log; managers choose (or leave it for later).
    if (!session.can('inquiries.assign')) _assignee = session.userId;
    if (widget.customerId != null) _pick({'id': widget.customerId});
  }

  @override
  void dispose() {
    for (final c in [_customCategory, _title, _requirements]) {
      c.dispose();
    }
    for (final i in _items) {
      i.dispose();
    }
    super.dispose();
  }

  /// Load the customer's contacts so the right person is on the deal.
  Future<void> _pick(Json c) async {
    setState(() => _customer = c);
    try {
      final full = await ref.read(repoProvider).customer(c.s('id'));
      final contacts = full.l('contacts');
      if (!mounted) return;
      setState(() {
        _customer = full;
        _contacts = contacts;
        _contactId = (contacts.firstWhere((x) => x.b('isPrimary'), orElse: () => contacts.firstOrNull ?? {})).sn('id');
      });
    } catch (e) {
      if (mounted) toast(context, e.toString(), error: true);
    }
  }

  String get _categoryValue => _category == _other ? _customCategory.text.trim() : _category;

  Future<void> _save() async {
    setState(() => _error = null);
    final body = <String, dynamic>{
      'customerId': _customer?.s('id') ?? '',
      'contactId': ?_contactId,
      'channel': _channel,
      'category': _categoryValue,
      if (_title.text.trim().isNotEmpty) 'title': _title.text.trim(),
      if (_requirements.text.trim().isNotEmpty) 'requirements': _requirements.text.trim(),
      'priority': _priority,
      if (_requiredBy.isNotEmpty) 'requiredBy': _requiredBy,
      if (_assignee.isNotEmpty) 'assigneeId': _assignee,
      'items': [for (final i in _items.where((i) => !i.isEmpty)) i.toJson()],
    };
    try {
      final res = await ref.mutate(() => ref.read(repoProvider).createDeal(body));
      if (mounted) {
        toast(context, 'Deal ${res.s('refNo')} created');
        context.pushReplacement('/deals/${res.s('id')}');
      }
    } on ApiException catch (e) {
      setState(() => _error = e);
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider).value ?? {};
    final people = ref.watch(peopleProvider).value ?? const [];
    final session = ref.watch(sessionProvider);
    final categories = settings.m('sales').ls('categories');
    final e = _error;

    return Scaffold(
      appBar: AppBar(title: const Text('New inquiry')),
      body: ListView(
        padding: pagePadding,
        children: [
          if (e != null && e.fieldErrors.isNotEmpty) const Notice('Please fix the highlighted fields.', tone: Tone.bad),
          SectionCard(
            title: 'Customer',
            trailing: TextButton(onPressed: () => context.push('/customers/new'), child: const Text('New customer')),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              CustomerPickerField(value: _customer, error: e?.field('customerId'), onChanged: _pick),
              if (_contacts.length > 1) ...[
                gap12,
                SelectField<String>(
                  label: 'Contact',
                  value: _contactId,
                  items: [for (final c in _contacts) (c.s('id'), c.sn('position') == null ? c.s('name') : '${c.s('name')} · ${c.s('position')}')],
                  onChanged: (v) => setState(() => _contactId = v),
                  error: e?.field('contactId'),
                ),
              ],
            ]),
          ),
          SectionCard(
            title: 'What does the customer need?',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SelectField<String>(
                label: 'Received via',
                value: _channel,
                items: [for (final s in channelLabel.entries) (s.key, s.value)],
                onChanged: (v) => setState(() => _channel = v ?? 'whatsapp'),
              ),
              SelectField<String>(
                label: 'Category',
                value: _category,
                hint: 'Choose a category…',
                error: _category == _other ? null : e?.field('category'),
                items: [for (final c in categories) (c, c), (_other, 'Other (type your own)…')],
                onChanged: (v) => setState(() => _category = v ?? ''),
              ),
              if (_category == _other) Field(label: 'Your category', controller: _customCategory, hint: 'e.g. Packaging machinery', error: e?.field('category')),
              const FieldLabel('Items'),
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text('One per machine or product: name on the first line, then capacity, size, voltage…', style: context.t.bodySmall),
              ),
              if (e?.field('items') != null) Notice(e!.field('items')!, tone: Tone.bad),
              for (var i = 0; i < _items.length; i++) _ItemEditor(
                key: ObjectKey(_items[i]),
                n: i + 1,
                item: _items[i],
                onRemove: _items.length == 1
                    ? null
                    : () => setState(() {
                          _items.removeAt(i).dispose();
                        }),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(onPressed: () => setState(() => _items.add(ItemDraft())), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Add an item')),
              ),
              gap8,
              Field(label: 'Other details', controller: _requirements, optional: true, maxLines: 5, minLines: 2, helper: 'Destination port, delivery time, standards, payment terms…', error: e?.field('requirements')),
              if (session.can('inquiries.assign'))
                SelectField<String>(
                  label: 'Handled by',
                  value: _assignee,
                  helper: 'Who will source and quote this',
                  items: [
                    ('', 'Not assigned yet'),
                    for (final p in people) (p.s('id'), p.s('id') == session.userId ? '${p.s('name')} (me)' : p.s('name')),
                  ],
                  onChanged: (v) => setState(() => _assignee = v ?? ''),
                  error: e?.field('assigneeId'),
                )
              else
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('I will handle it'),
                  subtitle: const Text('Off: a manager assigns it'),
                  value: _assignee == session.userId,
                  onChanged: (v) => setState(() => _assignee = v ? session.userId : ''),
                ),
            ]),
          ),
          SectionCard(
            title: 'More details',
            subtitle: 'Optional',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Field(label: 'Short title', controller: _title, optional: true, helper: 'Leave empty to name it after the items', error: e?.field('title')),
              SelectField<String>(
                label: 'Priority',
                value: _priority,
                items: [for (final p in priorityLabel.entries) (p.key, p.value)],
                onChanged: (v) => setState(() => _priority = v ?? 'normal'),
              ),
              DateField(label: 'Needed by', optional: true, clearable: true, value: _requiredBy, error: e?.field('requiredBy'), onChanged: (v) => setState(() => _requiredBy = v)),
            ]),
          ),
          const WebNote('Files can be added on the deal once it is saved. Factory prices and the quotation are made on the web.'),
          gap8,
          BusyButton(label: 'Create deal', onPressed: _save),
        ],
      ),
    );
  }
}

class _ItemEditor extends StatelessWidget {
  const _ItemEditor({super.key, required this.n, required this.item, this.onRemove});
  final int n;
  final ItemDraft item;
  final VoidCallback? onRemove;
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 12),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: context.c.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('Item $n', style: context.t.labelLarge),
          const Spacer(),
          if (onRemove != null) IconButton(tooltip: 'Remove item', icon: const Icon(Icons.close_rounded, size: 18), onPressed: onRemove),
        ]),
        TextField(controller: item.description, minLines: 2, maxLines: 6, decoration: const InputDecoration(hintText: 'e.g. Capsule filling machine\n25,000 capsules/hour, size 0–4')),
        gap8,
        TextField(controller: item.model, decoration: const InputDecoration(labelText: 'Brand / model (optional)')),
        gap8,
        Row(children: [
          Expanded(child: TextField(controller: item.quantity, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantity'))),
          gap8,
          Expanded(
            child: TextField(
              controller: item.unit,
              decoration: InputDecoration(
                labelText: 'Unit',
                suffixIcon: PopupMenuButton<String>(
                  tooltip: 'Choose a unit',
                  icon: const Icon(Icons.arrow_drop_down_rounded),
                  onSelected: (u) => item.unit.text = u,
                  itemBuilder: (_) => [for (final u in kUnits) PopupMenuItem(value: u, child: Text(u))],
                ),
              ),
            ),
          ),
        ]),
        gap8,
        TextField(controller: item.targetPrice, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: "Customer's target price (optional)")),
      ]),
    );
  }
}
