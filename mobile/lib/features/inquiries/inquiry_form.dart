import 'package:file_picker/file_picker.dart';
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

/// New inquiry (existing or new customer) or edit. Same fields and rules as the web form.
class InquiryFormScreen extends ConsumerStatefulWidget {
  const InquiryFormScreen({super.key, this.editId, this.customerId});
  final String? editId;
  final String? customerId;
  @override
  ConsumerState<InquiryFormScreen> createState() => _InquiryFormScreenState();
}

const _other = '__other__';

class _InquiryFormScreenState extends ConsumerState<InquiryFormScreen> {
  bool get _edit => widget.editId != null;
  bool _loaded = false;
  Object? _loadError;

  String _mode = 'existing';
  Json? _customer;
  final _contact = TextEditingController();
  final _company = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();

  String _category = '';
  final _customCategory = TextEditingController();
  String _source = 'whatsapp';
  final _specs = TextEditingController();
  final _title = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  String _priority = 'normal';
  String _requiredBy = '';
  String _assignee = '';
  final _files = <({String name, String path})>[];

  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    try {
      if (_edit) {
        final d = await api.get('/api/v1/inquiries/${widget.editId}');
        final q = d.m('query');
        _customer = d.m('customer');
        _category = q.s('category');
        _source = q.s('source');
        _specs.text = q.s('specifications');
        _title.text = q.s('title');
        _quantity.text = '${q.i('quantity', 1)}';
        _priority = q.s('priority', 'normal');
        _requiredBy = q.s('requiredBy');
      } else if (widget.customerId != null) {
        final c = await api.get('/api/v1/customers/${widget.customerId}');
        _customer = c.m('customer');
      }
      final session = ref.read(sessionProvider);
      if (!_edit && !session.can('queries.assign')) _assignee = session.userId;
      final meta = await ref.read(metaProvider.future);
      final known = meta.m('categories').ls('configured');
      if (_category.isNotEmpty && !known.contains(_category)) {
        _customCategory.text = _category;
        _category = _other;
      }
      setState(() => _loaded = true);
    } catch (e) {
      setState(() => _loadError = e);
    }
  }

  @override
  void dispose() {
    for (final c in [_contact, _company, _phone, _email, _customCategory, _specs, _title, _quantity]) {
      c.dispose();
    }
    super.dispose();
  }

  String get _categoryValue => _category == _other ? _customCategory.text.trim() : _category;

  Future<void> _save({bool allowDuplicate = false}) async {
    setState(() => _error = null);
    final api = ref.read(apiProvider);
    final details = {
      'category': _categoryValue,
      'source': _source,
      'specifications': _specs.text,
      'title': _title.text,
      'quantity': _quantity.text,
      'priority': _priority,
      'requiredBy': _requiredBy,
    };
    try {
      if (_edit) {
        if (_customer == null) throw ApiException('Choose a customer', fieldErrors: {'customerId': 'Choose a customer'});
        await ref.mutate(() => api.patch('/api/v1/inquiries/${widget.editId}', {...details, 'customerId': _customer!.s('id')}));
        if (mounted) {
          toast(context, 'Inquiry updated');
          context.pop();
        }
        return;
      }
      final body = {
        ...details,
        'assignedTo': _assignee,
        'customerMode': _mode,
        if (_mode == 'existing') 'customerId': _customer?.s('id') ?? '',
        if (_mode == 'new') ...{
          'contactPerson': _contact.text,
          'companyName': _company.text,
          'phone': _phone.text,
          'email': _email.text,
          if (allowDuplicate) 'allowDuplicate': 'on',
        },
      };
      final res = await ref.mutate(() => api.post('/api/v1/inquiries', body));
      final id = res.s('id');
      if (_files.isNotEmpty) {
        try {
          await api.uploadFiles(id, _files);
        } catch (e) {
          if (mounted) toast(context, 'The inquiry was saved, but the files could not be uploaded: $e', error: true);
        }
      }
      if (mounted) {
        toast(context, 'Inquiry ${res.s('refNo')} created');
        context.pushReplacement('/inquiries/$id');
      }
    } on ApiException catch (e) {
      if (e.duplicate && mounted) {
        await _duplicates(e);
        return;
      }
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _duplicates(ApiException e) async {
    final pick = await showSheet<String>(
      context,
      title: 'This customer may already exist',
      subtitle: 'A customer with the same phone number or email is already saved.',
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final m in e.duplicates)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Text(m.sn('companyName') ?? m.s('contactPerson')),
              subtitle: Text('${m.s('contactPerson')} · ${m.s('phone')}'),
              trailing: TextButton(onPressed: () => Navigator.pop(ctx, m.s('id')), child: const Text('Use')),
            ),
          ),
        gap8,
        OutlinedButton(onPressed: () => Navigator.pop(ctx, 'new'), child: const Text('No, add a new customer anyway')),
      ]),
    );
    if (pick == null) return;
    if (pick == 'new') {
      await _save(allowDuplicate: true);
    } else {
      final m = e.duplicates.firstWhere((d) => d.s('id') == pick);
      setState(() {
        _mode = 'existing';
        _customer = m;
      });
      await _save();
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = _edit ? 'Edit inquiry' : 'New inquiry';
    if (_loadError != null) return Scaffold(appBar: AppBar(title: Text(title)), body: ErrorState(_loadError!, onRetry: _load));
    if (!_loaded) return Scaffold(appBar: AppBar(title: Text(title)), body: const LoadingView());
    final meta = ref.watch(metaProvider).value ?? {};
    final session = ref.watch(sessionProvider);
    final e = _error;
    final categories = meta.m('categories').ls('configured');
    final others = meta.m('categories').ls('all').where((c) => !categories.contains(c)).toList();

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(
        padding: pagePadding,
        children: [
          if (e != null && e.fieldErrors.isNotEmpty) const Notice('Please fix the highlighted fields.', tone: Tone.bad),
          SectionCard(
            title: 'Customer',
            trailing: _edit
                ? null
                : SegmentedButton<String>(
                    showSelectedIcon: false,
                    style: const ButtonStyle(visualDensity: VisualDensity.compact),
                    segments: const [ButtonSegment(value: 'existing', label: Text('Existing')), ButtonSegment(value: 'new', label: Text('New'))],
                    selected: {_mode},
                    onSelectionChanged: (s) => setState(() => _mode = s.first),
                  ),
            child: _mode == 'existing' || _edit
                ? CustomerPickerField(value: _customer, error: e?.field('customerId'), onChanged: (c) => setState(() => _customer = c))
                : Column(children: [
                    Field(label: 'Full name', controller: _contact, error: e?.field('contactPerson'), textInputAction: TextInputAction.next),
                    Field(label: 'Company', controller: _company, optional: true, error: e?.field('companyName'), textInputAction: TextInputAction.next),
                    Field(label: 'Phone / WhatsApp', controller: _phone, keyboard: TextInputType.phone, helper: 'With country code, e.g. +971 50 123 4567', error: e?.field('phone')),
                    Field(label: 'Business email', controller: _email, optional: true, keyboard: TextInputType.emailAddress, error: e?.field('email')),
                  ]),
          ),
          SectionCard(
            title: 'What does the customer need?',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SelectField<String>(
                label: 'Sourcing category',
                value: _category,
                hint: 'Choose a sourcing category…',
                error: _category == _other ? null : e?.field('category'),
                items: [for (final c in categories) (c, c), (_other, 'Other (type your own)…')],
                onChanged: (v) => setState(() => _category = v ?? ''),
              ),
              if (_category == _other) ...[
                Field(label: 'Your category', controller: _customCategory, hint: 'e.g. Packaging Machinery', error: e?.field('category'), onChanged: (_) => setState(() {})),
                if (others.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final o in others.where((o) => o.toLowerCase().contains(_customCategory.text.toLowerCase())).take(6))
                        ActionChip(label: Text(o), onPressed: () => setState(() => _customCategory.text = o)),
                    ]),
                  ),
              ],
              SelectField<String>(
                label: 'Received via',
                value: _source,
                items: [for (final s in sourceLabel.entries) (s.key, s.value)],
                onChanged: (v) => setState(() => _source = v ?? 'whatsapp'),
              ),
              Field(label: 'Requirements', controller: _specs, maxLines: 8, minLines: 4, helper: 'Machine or product, model, capacity, quantity, destination port, delivery time', error: e?.field('specifications')),
              if (!_edit)
                SelectField<String>(
                  label: 'Handled by',
                  value: _assignee,
                  helper: 'Who will source and quote this',
                  items: [
                    ('', 'Not assigned yet'),
                    for (final p in meta.l('people')) (p.s('id'), p.s('id') == session.userId ? '${p.s('name')} (me)' : p.s('name')),
                  ],
                  onChanged: (v) => setState(() => _assignee = v ?? ''),
                  error: e?.field('assignedTo'),
                ),
            ]),
          ),
          SectionCard(
            title: 'More details',
            subtitle: 'Optional',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Field(label: 'Short title', controller: _title, optional: true, helper: 'Leave empty to use the first line of the requirements', error: e?.field('title')),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Field(label: 'Quantity', controller: _quantity, keyboard: TextInputType.number, error: e?.field('quantity'))),
                gap12,
                Expanded(
                  child: SelectField<String>(
                    label: 'Priority',
                    value: _priority,
                    items: [for (final p in priorityLabel.entries) (p.key, p.value)],
                    onChanged: (v) => setState(() => _priority = v ?? 'normal'),
                  ),
                ),
              ]),
              DateField(label: 'Needed by', optional: true, clearable: true, value: _requiredBy, error: e?.field('requiredBy'), onChanged: (v) => setState(() => _requiredBy = v)),
            ]),
          ),
          if (!_edit)
            SectionCard(
              title: 'Files',
              subtitle: 'Optional. Drawings, spec sheets, photos, factory quotes',
              trailing: TextButton.icon(
                onPressed: () async {
                  final picked = await FilePicker.pickFiles();
                  setState(() => _files.addAll([for (final p in picked) if (p.path != null) (name: p.name, path: p.path!)]));
                },
                icon: const Icon(Icons.attach_file_rounded, size: 18),
                label: const Text('Choose'),
              ),
              child: _files.isEmpty
                  ? Text('No files chosen.', style: context.t.bodySmall)
                  : Column(children: [
                      for (final file in _files)
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.insert_drive_file_outlined),
                          title: Text(file.name, overflow: TextOverflow.ellipsis),
                          trailing: IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(() => _files.remove(file))),
                        ),
                    ]),
            ),
          gap8,
          BusyButton(label: _edit ? 'Save changes' : 'Create inquiry', onPressed: _save),
        ],
      ),
    );
  }
}
