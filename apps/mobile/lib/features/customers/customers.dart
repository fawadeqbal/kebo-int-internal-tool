import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../../ui/paged.dart';
import '../inquiries/inquiries.dart';
import '../shell/shell.dart';

/* ---------------------------------------------------------------- List */

class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});
  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  String _q = '';
  String _has = '';
  String _sort = 'company';

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final session = ref.watch(sessionProvider);
    final api = ref.read(apiProvider);
    final query = {'q': _q, 'has': _has, 'sort': _sort == 'company' ? '' : _sort};
    return Scaffold(
      appBar: tabBar(context, 'Customers', actions: [
        PopupMenuButton<String>(
          tooltip: 'Sort',
          icon: const Icon(Icons.sort_rounded),
          initialValue: _sort,
          onSelected: (v) => setState(() => _sort = v),
          itemBuilder: (_) => const [PopupMenuItem(value: 'company', child: Text('Name (A–Z)')), PopupMenuItem(value: 'recent', child: Text('Latest inquiry'))],
        ),
      ]),
      floatingActionButton: session.can('customers.manage')
          ? FloatingActionButton(onPressed: () => context.push('/customers/new'), tooltip: 'Add customer', child: const Icon(Icons.person_add_alt_1_rounded))
          : null,
      body: PagedList(
        key: ValueKey('$version|$query'),
        load: (page) => api.get('/api/v1/customers', query: {...query, 'page': page}),
        header: [
          SearchBox(hint: 'Search name, company, phone, email…', initial: _q, onChanged: (v) => setState(() => _q = v)),
          ChoiceChips<String>(
            value: _has,
            onChanged: (v) => setState(() => _has = v),
            options: const [('', 'All'), ('open', 'With open inquiries'), ('unpaid', 'With unpaid invoices'), ('none', 'No inquiries yet')],
          ),
          if (!session.isManager) const Padding(padding: EdgeInsets.fromLTRB(16, 10, 16, 0), child: Text('Customers you added, or whose inquiries you handle.')),
          gap12,
        ],
        empty: const EmptyState(icon: Icons.people_outline_rounded, title: 'No customers found', message: 'Customers are added with their first inquiry, or here.'),
        itemBuilder: (context, c) => RowTile(
          leading: Avatar(c.s('contactPerson'), size: 36),
          title: f.customerName(c),
          subtitle: Text([if (c.sn('companyName') != null) c.s('contactPerson'), c.s('phone')].join(' · ')),
          trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('${c.i('queryCount')}', style: context.t.titleSmall),
            Text(c.i('queryCount') == 1 ? 'inquiry' : 'inquiries', style: context.t.bodySmall),
          ]),
          onTap: () => context.push('/customers/${c.s('id')}'),
        ),
      ),
    );
  }
}

/* ---------------------------------------------------------------- Detail */

class CustomerDetailScreen extends ConsumerWidget {
  const CustomerDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(getProvider('/api/v1/customers/$id'));
    final cur = ref.watch(metaProvider).value?.s('currency') ?? 'USD';
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/customers/$id')))),
      data: (d) {
        final c = d.m('customer');
        final can = d.m('can');
        final fin = d.mn('financials');
        final digits = c.s('phone').replaceAll(RegExp(r'\D'), '');
        return Scaffold(
          appBar: AppBar(
            title: const Text('Customer'),
            actions: [
              if (can.b('edit')) IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/customers/$id/edit')),
              if (can.b('delete'))
                PopupMenuButton<String>(
                  onSelected: (_) async {
                    if (!await confirm(context, title: 'Remove this customer?', message: 'Only customers without inquiries can be removed.', action: 'Remove', danger: true)) return;
                    try {
                      await ref.mutate(() => ref.read(apiProvider).delete('/api/v1/customers/$id'));
                      if (context.mounted) {
                        toast(context, 'Customer removed');
                        context.pop();
                      }
                    } catch (e) {
                      if (context.mounted) toast(context, e.toString(), error: true);
                    }
                  },
                  itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('Remove customer'))],
                ),
            ],
          ),
          floatingActionButton: can.b('newInquiry')
              ? FloatingActionButton.extended(onPressed: () => context.push('/inquiries/new?customer=$id'), icon: const Icon(Icons.add_rounded), label: const Text('New inquiry'))
              : null,
          body: ListView(padding: pagePadding, children: [
            Row(children: [
              Avatar(c.s('contactPerson'), size: 52),
              gap12,
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(f.customerName(c), style: context.t.titleLarge),
                  if (c.sn('companyName') != null) Text(c.s('contactPerson'), style: context.t.bodySmall),
                ]),
              ),
            ]),
            gap16,
            ContactButtons(
              phone: c.s('phone'),
              email: c.sn('email'),
              onCall: () => launchUrl(Uri.parse('tel:${c.s('phone')}')),
              onWhatsApp: () => launchUrl(Uri.parse('https://wa.me/$digits'), mode: LaunchMode.externalApplication),
              onEmail: () => launchUrl(Uri.parse('mailto:${c.s('email')}')),
            ),
            gap16,
            SectionCard(
              title: 'Details',
              child: kv([
                ('Phone / WhatsApp', c.s('phone')),
                ('Email', c.s('email', '—')),
                ('Address', c.s('address', '—')),
                ('Tax / Reg. no.', c.s('taxNo', '—')),
                if (c.b('vatExempt')) ('VAT', 'Exempt'),
                ('Customer since', f.date(c.s('createdAt'))),
              ]),
            ),
            if (c.sn('notes') != null) SectionCard(title: 'Notes', child: Text(c.s('notes'), style: context.t.bodyMedium!.copyWith(color: context.c.text2))),
            if (fin != null)
              StatGrid([
                StatTile(label: 'Invoiced', value: f.money(fin['invoiced'], cur)),
                StatTile(label: 'Received', value: f.money(fin['paid'], cur), tone: Tone.ok),
              ]),
            SectionCard(
              title: 'Inquiries (${d.l('inquiries').length})',
              padding: EdgeInsets.zero,
              child: d.l('inquiries').isEmpty
                  ? Padding(padding: const EdgeInsets.all(16), child: Text('No inquiries yet.', style: context.t.bodySmall))
                  : CardList(children: [for (final r in d.l('inquiries')) InquiryRow(r)]),
            ),
            if (d.l('invoices').isNotEmpty)
              SectionCard(
                title: 'Invoices',
                padding: EdgeInsets.zero,
                child: CardList(children: [
                  for (final i in d.l('invoices'))
                    RowTile(
                      mono: true,
                      title: i.s('invoiceNo'),
                      subtitle: Text('Issued ${f.date(i.s('issueDate'))} · due ${f.date(i.s('dueDate'))}'),
                      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [MoneyText(i['total'], i.s('currency', cur)), invoiceStatusBadge(invoiceDisplayStatus(i, f.today()))]),
                      onTap: () => context.push('/invoices/${i.s('id')}'),
                    ),
                ]),
              ),
            const SizedBox(height: 72),
          ]),
        );
      },
    );
  }
}

/* ---------------------------------------------------------------- Form */

class CustomerFormScreen extends ConsumerStatefulWidget {
  const CustomerFormScreen({super.key, this.editId});
  final String? editId;
  @override
  ConsumerState<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends ConsumerState<CustomerFormScreen> {
  final _f = {for (final k in ['contactPerson', 'companyName', 'phone', 'email', 'address', 'taxNo', 'notes']) k: TextEditingController()};
  bool _loaded = false;
  bool _vatExempt = false;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    if (widget.editId == null) {
      _loaded = true;
    } else {
      ref.read(apiProvider).get('/api/v1/customers/${widget.editId}').then((d) {
        final c = d.m('customer');
        for (final e in _f.entries) {
          e.value.text = c.s(e.key);
        }
        _vatExempt = c.b('vatExempt');
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

  Future<void> _save({bool allowDuplicate = false}) async {
    setState(() => _error = null);
    final api = ref.read(apiProvider);
    final manager = ref.read(sessionProvider).isManager;
    final body = {for (final e in _f.entries) e.key: e.value.text, if (manager) 'vatExempt': _vatExempt, if (allowDuplicate) 'allowDuplicate': 'on'};
    try {
      if (widget.editId != null) {
        await ref.mutate(() => api.patch('/api/v1/customers/${widget.editId}', body));
        if (mounted) {
          toast(context, 'Customer saved');
          context.pop();
        }
      } else {
        final res = await ref.mutate(() => api.post('/api/v1/customers', body));
        if (mounted) {
          toast(context, 'Customer added');
          context.pushReplacement('/customers/${res.s('id')}');
        }
      }
    } on ApiException catch (e) {
      if (e.duplicate && mounted) {
        final go = await confirm(
          context,
          title: 'This customer may already exist',
          message: e.duplicates.map((m) => '• ${m.sn('companyName') ?? m.s('contactPerson')} · ${m.s('phone')}').join('\n'),
          action: 'Save anyway',
        );
        if (go) await _save(allowDuplicate: true);
        return;
      }
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _error;
    return Scaffold(
      appBar: AppBar(title: Text(widget.editId == null ? 'Add customer' : 'Edit customer')),
      body: !_loaded
          ? const LoadingView()
          : ListView(padding: pagePadding, children: [
              SectionCard(
                child: Column(children: [
                  Field(label: 'Full name', controller: _f['contactPerson']!, error: e?.field('contactPerson')),
                  Field(label: 'Company', controller: _f['companyName']!, optional: true, error: e?.field('companyName')),
                  Field(label: 'Phone / WhatsApp', controller: _f['phone']!, keyboard: TextInputType.phone, helper: 'With country code, e.g. +971 50 123 4567', error: e?.field('phone')),
                  Field(label: 'Business email', controller: _f['email']!, optional: true, keyboard: TextInputType.emailAddress, error: e?.field('email')),
                  Field(label: 'Address', controller: _f['address']!, optional: true, maxLines: 3, error: e?.field('address')),
                  Field(label: 'Tax / Reg. no.', controller: _f['taxNo']!, optional: true, error: e?.field('taxNo')),
                  Field(label: 'Notes', controller: _f['notes']!, optional: true, maxLines: 4, error: e?.field('notes')),
                  if (ref.watch(sessionProvider).isManager)
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('VAT exempt'),
                      subtitle: const Text('Their quotations and invoices carry no VAT, e.g. export customers'),
                      value: _vatExempt,
                      onChanged: (v) => setState(() => _vatExempt = v),
                    ),
                ]),
              ),
              BusyButton(label: widget.editId == null ? 'Add customer' : 'Save customer', onPressed: _save),
            ]),
    );
  }
}

/* ---------------------------------------------------------------- Picker */

/// "Choose a customer" field: opens a search sheet over the customers this person can see.
class CustomerPickerField extends ConsumerWidget {
  const CustomerPickerField({super.key, required this.value, required this.onChanged, this.error});
  final Json? value;
  final ValueChanged<Json> onChanged;
  final String? error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () async {
          final picked = await showModalBottomSheet<Json>(context: context, isScrollControlled: true, useSafeArea: true, builder: (_) => const _CustomerSearchSheet());
          if (picked != null) onChanged(picked);
        },
        child: InputDecorator(
          decoration: InputDecoration(errorText: error, prefixIcon: const Icon(Icons.search_rounded, size: 20), suffixIcon: const Icon(Icons.expand_more_rounded)),
          child: value == null
              ? Text('Search by name, company or phone', style: TextStyle(color: context.c.muted))
              : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(f.customerName(value!), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                  Text([if (value!.sn('companyName') != null) value!.s('contactPerson'), value!.s('phone')].join(' · '), style: context.t.bodySmall),
                ]),
        ),
      ),
    ]);
  }
}

class _CustomerSearchSheet extends ConsumerStatefulWidget {
  const _CustomerSearchSheet();
  @override
  ConsumerState<_CustomerSearchSheet> createState() => _CustomerSearchSheetState();
}

class _CustomerSearchSheetState extends ConsumerState<_CustomerSearchSheet> {
  List<Json> _results = [];
  bool _loading = false;

  Future<void> _search(String q) async {
    if (q.length < 2) {
      setState(() => _results = []);
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await ref.read(apiProvider).get('/api/v1/customers', query: {'q': q});
      if (mounted) setState(() => _results = res.l('rows'));
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
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 4), child: Align(alignment: Alignment.centerLeft, child: Text('Choose a customer', style: context.t.titleLarge))),
          SearchBox(hint: 'Name, company or phone…', onChanged: _search),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: _results.isEmpty
                ? Center(child: Text('Type at least 2 letters to search.', style: context.t.bodySmall))
                : ListView(children: [
                    for (final c in _results)
                      ListTile(
                        leading: Avatar(c.s('contactPerson')),
                        title: Text(f.customerName(c)),
                        subtitle: Text([if (c.sn('companyName') != null) c.s('contactPerson'), c.s('phone')].join(' · ')),
                        onTap: () => Navigator.pop(context, c),
                      ),
                  ]),
          ),
        ]),
      ),
    );
  }
}
