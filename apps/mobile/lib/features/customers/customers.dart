import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../../ui/paged.dart';
import '../deals/deals.dart';
import '../shell/shell.dart';

/* ---------------------------------------------------------------- List */

class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});
  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final session = ref.watch(sessionProvider);
    final repo = ref.read(repoProvider);
    return Scaffold(
      appBar: tabBar(context, 'Customers'),
      floatingActionButton: session.can('customers.manage')
          ? FloatingActionButton(onPressed: () => context.push('/customers/new'), tooltip: 'Add customer', child: const Icon(Icons.person_add_alt_1_rounded))
          : null,
      body: PagedList(
        key: ValueKey('$version|$_q'),
        load: (page) => repo.customers(q: _q, page: page),
        header: [
          SearchBox(hint: 'Search name, contact, phone, email…', initial: _q, onChanged: (v) => setState(() => _q = v)),
          if (!session.isManager) const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 0), child: Text('Customers you added, or whose deals you handle.')),
          gap12,
        ],
        empty: const EmptyState(icon: Icons.people_outline_rounded, title: 'No customers found', message: 'Customers are added with their first deal, or here.'),
        itemBuilder: (context, c) => CustomerRow(c),
      ),
    );
  }
}

class CustomerRow extends StatelessWidget {
  const CustomerRow(this.c, {super.key});
  final Json c;
  @override
  Widget build(BuildContext context) {
    final contact = c.m('primaryContact');
    return RowTile(
      leading: Avatar(c.s('name'), size: 36),
      title: c.s('name'),
      subtitle: Text([countryName(c.s('country')), if (contact.isNotEmpty) contact.s('name'), if (contact.sn('phone') != null) contact.s('phone')].join(' · ')),
      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text('${c.i('openDeals')}', style: context.t.titleSmall),
        Text(c.i('openDeals') == 1 ? 'open deal' : 'open deals', style: context.t.bodySmall),
      ]),
      onTap: () => context.push('/customers/${c.s('id')}'),
    );
  }
}

/* ---------------------------------------------------------------- Detail */

final customerProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).customer(id);
});

class CustomerDetailScreen extends ConsumerWidget {
  const CustomerDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(customerProvider(id));
    final session = ref.watch(sessionProvider);
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(customerProvider(id)))),
      data: (c) {
        final contacts = c.l('contacts');
        final deals = [for (final d in c.l('inquiries')) {...d, 'customer': {'id': c.s('id'), 'name': c.s('name')}}];
        return Scaffold(
          appBar: AppBar(title: const Text('Customer')),
          floatingActionButton: session.can('inquiries.create')
              ? FloatingActionButton.extended(onPressed: () => context.push('/deals/new?customer=$id'), icon: const Icon(Icons.add_rounded), label: const Text('New deal'))
              : null,
          body: RefreshIndicator(
            onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
            child: ListView(padding: pagePadding, children: [
              Row(children: [
                Avatar(c.s('name'), size: 52),
                gap12,
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(c.s('name'), style: context.t.titleLarge),
                    Text('${customerTypeLabel[c.s('type')] ?? c.s('type')} · ${countryName(c.s('country'))}', style: context.t.bodySmall),
                  ]),
                ),
              ]),
              gap16,
              if (c.s('country') == unknownCountry) const Notice('The country is not known yet. Ask the customer and add it on the web.', tone: Tone.warn),
              for (final ct in contacts)
                SectionCard(
                  title: ct.s('name'),
                  subtitle: [if (ct.b('isPrimary')) 'Main contact', if (ct.sn('position') != null) ct.s('position')].join(' · ').ifEmpty(null),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    ContactActions(ct),
                    gap8,
                    kv(contactRows(ct)),
                  ]),
                ),
              SectionCard(
                title: 'Details',
                child: kv([
                  ('Currency', c.s('defaultCurrency', 'USD')),
                  ('Address', c.s('address', '—')),
                  ('Tax / Reg. no.', c.s('taxNo', '—')),
                  ('Customer since', f.date(c.s('createdAt'))),
                ]),
              ),
              if (c.sn('notes') != null) SectionCard(title: 'Notes', child: Text(c.s('notes'), style: context.t.bodyMedium!.copyWith(color: context.c.text2))),
              SectionCard(
                title: 'Deals (${deals.length})',
                padding: EdgeInsets.zero,
                child: deals.isEmpty
                    ? Padding(padding: const EdgeInsets.all(16), child: Text('No deals yet.', style: context.t.bodySmall))
                    : CardList(children: [for (final r in deals) DealRow(r)]),
              ),
              if (c.l('orders').isNotEmpty)
                SectionCard(
                  title: 'Orders',
                  padding: EdgeInsets.zero,
                  child: CardList(children: [
                    for (final o in c.l('orders'))
                      RowTile(
                        mono: true,
                        title: o.s('refNo'),
                        subtitle: Text('Ordered ${f.date(o.s('orderedOn'))} · ${o.s('status')}'),
                        trailing: MoneyText(o['total'], o.s('currency', 'USD')),
                        onTap: () => context.push('/orders/${o.s('id')}'),
                      ),
                  ]),
                ),
              const WebNote('Editing or removing a customer is done on the web.'),
              const SizedBox(height: 72),
            ]),
          ),
        );
      },
    );
  }
}

extension on String {
  String? ifEmpty(String? other) => isEmpty ? other : this;
}

/* ---------------------------------------------------------------- Form */

class ContactDraft {
  final name = TextEditingController();
  final phone = TextEditingController();
  final whatsapp = TextEditingController();
  final email = TextEditingController();
  final wechat = TextEditingController();
  final position = TextEditingController();

  Json toJson({required bool primary}) => {
        'name': name.text.trim(),
        for (final e in {'phone': phone, 'whatsapp': whatsapp, 'email': email, 'wechat': wechat, 'position': position}.entries)
          if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(),
        'isPrimary': primary,
      };

  void dispose() {
    for (final c in [name, phone, whatsapp, email, wechat, position]) {
      c.dispose();
    }
  }
}

/// Add a customer with its contacts. A matching phone or email elsewhere is shown first, with "Save anyway".
class CustomerFormScreen extends ConsumerStatefulWidget {
  const CustomerFormScreen({super.key});
  @override
  ConsumerState<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends ConsumerState<CustomerFormScreen> {
  String _type = 'company';
  final _name = TextEditingController();
  String _country = '';
  final _otherCountry = TextEditingController();
  final _address = TextEditingController();
  final _taxNo = TextEditingController();
  final _notes = TextEditingController();
  final _contacts = <ContactDraft>[ContactDraft()];
  bool _sameWhatsApp = true;
  ApiException? _error;

  @override
  void dispose() {
    for (final c in [_name, _otherCountry, _address, _taxNo, _notes]) {
      c.dispose();
    }
    for (final c in _contacts) {
      c.dispose();
    }
    super.dispose();
  }

  String get _countryValue => _country == '__other__' ? _otherCountry.text.trim().toUpperCase() : _country;

  Json _body() => {
        'type': _type,
        'name': _name.text.trim(),
        'country': _countryValue,
        if (_address.text.trim().isNotEmpty) 'address': _address.text.trim(),
        if (_taxNo.text.trim().isNotEmpty) 'taxNo': _taxNo.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
        'contacts': [
          for (var i = 0; i < _contacts.length; i++)
            {
              ..._contacts[i].toJson(primary: i == 0),
              if (i == 0 && _sameWhatsApp && _contacts[0].phone.text.trim().isNotEmpty && _contacts[0].whatsapp.text.trim().isEmpty) 'whatsapp': _contacts[0].phone.text.trim(),
            },
        ],
      };

  Future<void> _save({bool allowDuplicate = false}) async {
    setState(() => _error = null);
    try {
      final res = await ref.mutate(() => ref.read(repoProvider).createCustomer(_body(), allowDuplicate: allowDuplicate));
      if (mounted) {
        toast(context, 'Customer added');
        context.pushReplacement('/customers/${res.s('id')}');
      }
    } on ApiException catch (e) {
      if (e.duplicate && mounted) {
        await _duplicates(e);
        return;
      }
      setState(() => _error = e);
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _duplicates(ApiException e) async {
    final pick = await showSheet<String>(
      context,
      title: 'This customer may already exist',
      subtitle: e.message,
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final m in e.matches)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Text(m.s('label')),
              subtitle: m.sn('detail') == null ? null : Text(m.s('detail')),
              trailing: TextButton(onPressed: () => Navigator.pop(ctx, m.s('id')), child: const Text('Open')),
            ),
          ),
        gap8,
        OutlinedButton(onPressed: () => Navigator.pop(ctx, '__save__'), child: const Text('No, save anyway')),
      ]),
    );
    if (pick == null || !mounted) return;
    if (pick == '__save__') {
      await _save(allowDuplicate: true);
    } else {
      context.pushReplacement('/customers/$pick');
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _error;
    return Scaffold(
      appBar: AppBar(title: const Text('Add customer')),
      body: ListView(padding: pagePadding, children: [
        if (e != null && e.fieldErrors.isNotEmpty) const Notice('Please fix the highlighted fields.', tone: Tone.bad),
        SectionCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: SegmentedButton<String>(
                showSelectedIcon: false,
                segments: [for (final t in customerTypeLabel.entries) ButtonSegment(value: t.key, label: Text(t.value))],
                selected: {_type},
                onSelectionChanged: (s) => setState(() => _type = s.first),
              ),
            ),
            Field(label: _type == 'company' ? 'Company name' : 'Full name', controller: _name, error: e?.field('name')),
            SelectField<String>(
              label: 'Country',
              value: _country,
              hint: 'Choose a country…',
              error: _country == '__other__' ? null : e?.field('country'),
              items: [for (final c in (countryNames.entries.toList()..sort((a, b) => a.value.compareTo(b.value)))) (c.key, c.value), ('__other__', 'Other (type the 2-letter code)…')],
              onChanged: (v) => setState(() => _country = v ?? ''),
            ),
            if (_country == '__other__') Field(label: 'Country code', controller: _otherCountry, hint: 'e.g. FR', error: e?.field('country')),
          ]),
        ),
        for (var i = 0; i < _contacts.length; i++)
          SectionCard(
            title: i == 0 ? 'Main contact' : 'Contact ${i + 1}',
            trailing: i == 0 ? null : IconButton(tooltip: 'Remove contact', icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(() => _contacts.removeAt(i).dispose())),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Field(label: 'Name', controller: _contacts[i].name, textInputAction: TextInputAction.next),
              Field(label: 'Phone', controller: _contacts[i].phone, keyboard: TextInputType.phone, optional: true, helper: 'With country code, e.g. +971 50 123 4567'),
              if (i == 0)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Same number on WhatsApp'),
                  value: _sameWhatsApp,
                  onChanged: (v) => setState(() => _sameWhatsApp = v),
                ),
              if (i > 0 || !_sameWhatsApp) Field(label: 'WhatsApp', controller: _contacts[i].whatsapp, keyboard: TextInputType.phone, optional: true),
              Field(label: 'Email', controller: _contacts[i].email, keyboard: TextInputType.emailAddress, optional: true),
              Field(label: 'WeChat', controller: _contacts[i].wechat, optional: true),
              Field(label: 'Position', controller: _contacts[i].position, optional: true),
            ]),
          ),
        if (e?.field('contacts') != null) Notice(e!.field('contacts')!, tone: Tone.bad),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(onPressed: () => setState(() => _contacts.add(ContactDraft())), icon: const Icon(Icons.person_add_alt_rounded, size: 18), label: const Text('Add another contact')),
        ),
        SectionCard(
          title: 'More details',
          subtitle: 'Optional',
          child: Column(children: [
            Field(label: 'Address', controller: _address, optional: true, maxLines: 3, error: e?.field('address')),
            Field(label: 'Tax / Reg. no.', controller: _taxNo, optional: true, error: e?.field('taxNo')),
            Field(label: 'Notes', controller: _notes, optional: true, maxLines: 4, error: e?.field('notes')),
          ]),
        ),
        BusyButton(label: 'Add customer', onPressed: _save),
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
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () async {
        final picked = await showModalBottomSheet<Json>(context: context, isScrollControlled: true, useSafeArea: true, builder: (_) => const _CustomerSearchSheet());
        if (picked != null) onChanged(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(errorText: error, prefixIcon: const Icon(Icons.search_rounded, size: 20), suffixIcon: const Icon(Icons.expand_more_rounded)),
        child: value == null || value!.sn('name') == null
            ? Text(value == null ? 'Search by name, contact or phone' : 'Loading…', style: TextStyle(color: context.c.muted))
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(value!.s('name'), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                Text(countryName(value!.s('country')), style: context.t.bodySmall),
              ]),
      ),
    );
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

  @override
  void initState() {
    super.initState();
    _search('');
  }

  Future<void> _search(String q) async {
    setState(() => _loading = true);
    try {
      final res = await ref.read(repoProvider).customers(q: q);
      if (mounted) setState(() => _results = res.l('rows'));
    } catch (e) {
      if (mounted) toast(context, e.toString(), error: true);
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
          SearchBox(hint: 'Name, contact, phone or email…', onChanged: _search),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: _results.isEmpty
                ? Center(child: Text(_loading ? '' : 'No customers found.', style: context.t.bodySmall))
                : ListView(children: [
                    for (final c in _results)
                      ListTile(
                        leading: Avatar(c.s('name')),
                        title: Text(c.s('name')),
                        subtitle: Text([countryName(c.s('country')), if (c.m('primaryContact').isNotEmpty) c.m('primaryContact').s('name')].join(' · ')),
                        onTap: () => Navigator.pop(context, c),
                      ),
                  ]),
          ),
        ]),
      ),
    );
  }
}
