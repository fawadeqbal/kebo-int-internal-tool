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

/* ---------------------------------------------------------------- Users */

class UsersScreen extends ConsumerStatefulWidget {
  const UsersScreen({super.key});
  @override
  ConsumerState<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends ConsumerState<UsersScreen> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final data = ref.watch(getProvider('/api/v1/users'));
    return Scaffold(
      appBar: AppBar(title: const Text('Users')),
      floatingActionButton: FloatingActionButton(onPressed: () => context.push('/users/new'), tooltip: 'Add user', child: const Icon(Icons.person_add_alt_1_rounded)),
      body: data.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/users'))),
        data: (d) {
          final users = d.l('users').where((u) => _q.isEmpty || '${u.s('name')} ${u.s('email')}'.toLowerCase().contains(_q.toLowerCase())).toList();
          return ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            SearchBox(hint: 'Search name or email…', onChanged: (v) => setState(() => _q = v)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Card(
                clipBehavior: Clip.antiAlias,
                child: CardList(children: [
                  for (final u in users)
                    RowTile(
                      leading: Avatar(u.s('name'), size: 36),
                      title: u.s('name'),
                      subtitle: Text('${u.s('email')}\nLast sign-in ${f.dateTime(u.sn('lastLoginAt'))}'),
                      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        ToneBadge(roleLabel[u.s('role')] ?? u.s('role'), tone: u.s('role') == 'admin' ? Tone.primary : u.s('role') == 'manager' ? Tone.trust : Tone.neutral),
                        const SizedBox(height: 4),
                        if (!u.b('isActive')) const ToneBadge('Deactivated') else if (u.b('twoStepOn')) const ToneBadge('Two-step on', tone: Tone.ok),
                      ]),
                      onTap: () => context.push('/users/${u.s('id')}'),
                    ),
                ]),
              ),
            ),
          ]);
        },
      ),
    );
  }
}

class UserFormScreen extends ConsumerStatefulWidget {
  const UserFormScreen({super.key});
  @override
  ConsumerState<UserFormScreen> createState() => _UserFormScreenState();
}

class _UserFormScreenState extends ConsumerState<UserFormScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String _role = 'staff';
  ApiException? _error;

  @override
  Widget build(BuildContext context) {
    final e = _error;
    return Scaffold(
      appBar: AppBar(title: const Text('Add user')),
      body: ListView(padding: pagePadding, children: [
        SectionCard(
          child: Column(children: [
            Field(label: 'Full name', controller: _name, error: e?.field('name')),
            Field(label: 'Email', controller: _email, keyboard: TextInputType.emailAddress, error: e?.field('email')),
            SelectField<String>(
              label: 'Role',
              value: _role,
              helper: _roleHelp(_role),
              items: [for (final r in roleLabel.entries) (r.key, r.value)],
              onChanged: (v) => setState(() => _role = v ?? 'staff'),
            ),
            Field(label: 'Temporary password', controller: _password, helper: 'At least 8 characters, with a letter and a number. Share it securely.', error: e?.field('password')),
          ]),
        ),
        BusyButton(
          label: 'Add user',
          onPressed: () async {
            setState(() => _error = null);
            try {
              final res = await ref.mutate(() => ref.read(apiProvider).post('/api/v1/users', {'name': _name.text, 'email': _email.text, 'role': _role, 'password': _password.text}));
              if (context.mounted) {
                toast(context, 'User created');
                context.pushReplacement('/users/${res.s('id')}');
              }
            } on ApiException catch (err) {
              setState(() => _error = err);
              if (err.fieldErrors.isEmpty && context.mounted) toast(context, err.message, error: true);
            }
          },
        ),
      ]),
    );
  }
}

String _roleHelp(String role) => switch (role) {
      'admin' => 'Everything: all work and sales, users, settings, audit log.',
      'manager' => 'All inquiries, assigning work, quotations, invoices, payments, reports, audit log.',
      _ => 'Their own inquiries and those customers, quotations.',
    };

class UserDetailScreen extends ConsumerStatefulWidget {
  const UserDetailScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<UserDetailScreen> createState() => _UserDetailScreenState();
}

class _UserDetailScreenState extends ConsumerState<UserDetailScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String _role = 'staff';
  bool _filled = false;
  bool _editProfile = false;
  bool _editPassword = false;
  ApiException? _error;

  @override
  Widget build(BuildContext context) {
    final data = ref.watch(getProvider('/api/v1/users/${widget.id}'));
    final api = ref.read(apiProvider);
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e)),
      data: (d) {
        final u = d.m('user');
        if (!_filled) {
          _name.text = u.s('name');
          _email.text = u.s('email');
          _role = u.s('role');
          _filled = true;
        }
        final e = _error;
        final self = d.b('isSelf');
        return Scaffold(
          appBar: AppBar(title: Text(u.s('name'))),
          body: ListView(padding: pagePadding, children: [
            Wrap(spacing: 6, children: [
              u.b('isActive') ? const ToneBadge('Active', tone: Tone.ok, dot: true) : const ToneBadge('Deactivated', dot: true),
              ToneBadge(u.b('twoStepOn') ? 'Two-step on' : 'Two-step off', tone: u.b('twoStepOn') ? Tone.ok : (d.b('twoStepRequired') ? Tone.warn : Tone.outline)),
            ]),
            gap4,
            Text('Last sign-in ${f.dateTime(u.sn('lastLoginAt'))}', style: context.t.bodySmall),
            gap16,
            SectionCard(
              title: 'Profile & role',
              trailing: _editProfile ? null : TextButton.icon(onPressed: () => setState(() => _editProfile = true), icon: const Icon(Icons.edit_outlined, size: 16), label: const Text('Edit')),
              child: !_editProfile
                  ? kv([('Name', u.s('name')), ('Email', u.s('email')), ('Role', roleLabel[u.s('role')] ?? u.s('role'))])
                  : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Field(label: 'Full name', controller: _name, error: e?.field('name')),
                      Field(label: 'Email', controller: _email, keyboard: TextInputType.emailAddress, error: e?.field('email')),
                      SelectField<String>(label: 'Role', value: _role, helper: _roleHelp(_role), items: [for (final r in roleLabel.entries) (r.key, r.value)], onChanged: (v) => setState(() => _role = v ?? _role)),
                      Row(children: [
                        Expanded(
                          child: BusyButton(
                            label: 'Save',
                            onPressed: () async {
                              setState(() => _error = null);
                              try {
                                await ref.mutate(() => api.patch('/api/v1/users/${widget.id}', {'name': _name.text, 'email': _email.text, 'role': _role}));
                                setState(() => _editProfile = false);
                                if (context.mounted) toast(context, 'User updated');
                              } on ApiException catch (err) {
                                setState(() => _error = err);
                                if (err.fieldErrors.isEmpty) rethrow;
                              }
                            },
                          ),
                        ),
                        gap8,
                        TextButton(
                          onPressed: () => setState(() {
                            _name.text = u.s('name');
                            _email.text = u.s('email');
                            _role = u.s('role');
                            _error = null;
                            _editProfile = false;
                          }),
                          child: const Text('Cancel'),
                        ),
                      ]),
                    ]),
            ),
            SectionCard(
              title: 'Password',
              subtitle: 'For a person who forgot theirs: set a temporary one and share it. They are signed out everywhere.',
              child: !_editPassword
                  ? Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton(onPressed: () => setState(() => _editPassword = true), child: const Text('Set a temporary password')),
                    )
                  : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Field(label: 'New password', controller: _password, error: e?.field('password'), helper: 'At least 8 characters, with a letter and a number'),
                      Row(children: [
                        Expanded(
                          child: BusyButton(
                            label: 'Set new password',
                            onPressed: () async {
                              setState(() => _error = null);
                              try {
                                final res = await ref.mutate(() => api.post('/api/v1/users/${widget.id}/password', {'password': _password.text}));
                                _password.clear();
                                setState(() => _editPassword = false);
                                if (context.mounted) toast(context, res.s('message', 'Password updated'));
                              } on ApiException catch (err) {
                                setState(() => _error = err);
                                if (err.fieldErrors.isEmpty) rethrow;
                              }
                            },
                          ),
                        ),
                        gap8,
                        TextButton(onPressed: () => setState(() => _editPassword = false), child: const Text('Cancel')),
                      ]),
                    ]),
            ),
            if (!self) ...[
              SectionCard(
                title: 'Two-step sign-in',
                subtitle: u.b('twoStepOn')
                    ? 'On. If they lost their phone and their recovery codes, reset it: they are signed out and set it up again at next sign-in.'
                    : d.b('twoStepRequired')
                        ? 'Not set up yet. They will be asked to set it up when they next sign in.'
                        : 'Off (optional for this role).',
                child: u.b('twoStepOn')
                    ? BusyButton(
                        label: 'Reset two-step sign-in',
                        style: BusyStyle.outlined,
                        onPressed: () async {
                          if (!await confirm(context, title: 'Reset two-step sign-in for ${u.s('name')}?', message: 'They will be signed out everywhere.', action: 'Reset')) return;
                          await ref.mutate(() => api.post('/api/v1/users/${widget.id}/two-step-reset'));
                          if (context.mounted) toast(context, 'Two-step sign-in reset; they set it up at next sign-in');
                        },
                      )
                    : const SizedBox(),
              ),
              SectionCard(
                title: u.b('isActive') ? 'Deactivate account' : 'Reactivate account',
                subtitle: u.b('isActive') ? 'The user is signed out and can no longer sign in. Their history is kept.' : 'Allow this user to sign in again.',
                child: BusyButton(
                  label: u.b('isActive') ? 'Deactivate' : 'Reactivate',
                  style: u.b('isActive') ? BusyStyle.danger : BusyStyle.outlined,
                  onPressed: () async {
                    if (!await confirm(context, title: '${u.b('isActive') ? 'Deactivate' : 'Reactivate'} ${u.s('name')}?', message: u.b('isActive') ? 'They are signed out at once.' : 'They can sign in again.', action: u.b('isActive') ? 'Deactivate' : 'Reactivate', danger: u.b('isActive'))) return;
                    await ref.mutate(() => api.post('/api/v1/users/${widget.id}/active', {'isActive': !u.b('isActive')}));
                    if (context.mounted) toast(context, u.b('isActive') ? 'User deactivated' : 'User activated');
                  },
                ),
              ),
            ],
          ]),
        );
      },
    );
  }
}

/* ---------------------------------------------------------------- Settings */

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});
  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  static const _text = [
    'companyName', 'companyNameLocal', 'companyEmail2', 'companyAddress', 'companyPhone', 'companyEmail', 'companyWebsite', 'companyTaxNo', 'bankDetails', 'currency', 'vatRate',
    'quotationValidityDays', 'invoicePaymentDays', 'reminderPendingDays', 'reminderProcessingDays', 'reminderDueSoonDays', 'defaultQuotationTerms', 'invoiceFooter',
    'defaultMarginPercent',
  ];

  /// { CNY: 7.1 } → "CNY = 7.1" lines, as they are typed.
  static String _ratesText(Json raw) => raw.m('exchangeRates').entries.map((e) => '${e.key} = ${e.value}').join('\n');
  static const _switches = {
    'notifyNewQuery': 'New inquiries',
    'notifyClosed': 'Inquiries closed',
    'notifyQuotation': 'Quotations accepted or rejected',
    'notifyPayment': 'Payments received',
    'notifyDailySummary': 'Daily summary',
  };
  final _c = {for (final k in [..._text, 'categories', 'notifyEmails', 'exchangeRates']) k: TextEditingController()};
  final _on = <String, bool>{};
  bool _loaded = false;
  Object? _loadError;
  ApiException? _error;
  Json _raw = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ref.read(apiProvider).get('/api/v1/settings');
      _raw = res.m('settings');
      for (final k in _text) {
        _c[k]!.text = _raw.s(k);
      }
      _c['categories']!.text = _raw.ls('categories').join('\n');
      _c['notifyEmails']!.text = _raw.ls('notifyEmails').join(', ');
      _c['exchangeRates']!.text = _ratesText(_raw);
      _vatIncluded = _raw.b('pricesIncludeVat');
      for (final k in _switches.keys) {
        _on[k] = _raw.b(k);
      }
      setState(() => _loaded = true);
    } catch (e) {
      setState(() => _loadError = e);
    }
  }

  Json get _body => {
        ..._raw,
        for (final k in _text) k: _c[k]!.text,
        'categories': _c['categories']!.text.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
        'notifyEmails': _c['notifyEmails']!.text.split(RegExp(r'[\s,;]+')).where((s) => s.isNotEmpty).toList(),
        'exchangeRates': _c['exchangeRates']!.text,
        for (final k in _switches.keys) k: _on[k] ?? false,
        'pricesIncludeVat': _vatIncluded,
      };

  bool _vatIncluded = false;

  /// The section being edited (one at a time); the rest are read-only.
  String? _editing;

  void _reset() {
    for (final k in _text) {
      _c[k]!.text = _raw.s(k);
    }
    _c['categories']!.text = _raw.ls('categories').join('\n');
    _c['notifyEmails']!.text = _raw.ls('notifyEmails').join(', ');
    _c['exchangeRates']!.text = _ratesText(_raw);
    _vatIncluded = _raw.b('pricesIncludeVat');
    for (final k in _switches.keys) {
      _on[k] = _raw.b(k);
    }
  }

  Future<void> _saveSection() async {
    setState(() => _error = null);
    try {
      final res = await ref.mutate(() => ref.read(apiProvider).put('/api/v1/settings', _body));
      ref.invalidate(metaProvider);
      setState(() {
        _raw = res.m('settings');
        _reset();
        _editing = null;
      });
      if (mounted) toast(context, 'Settings saved.');
    } on ApiException catch (err) {
      setState(() => _error = err);
      if (err.fieldErrors.isEmpty) rethrow;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadError != null) return Scaffold(appBar: AppBar(title: const Text('Settings')), body: ErrorState(_loadError!, onRetry: _load));
    if (!_loaded) return Scaffold(appBar: AppBar(title: const Text('Settings')), body: const LoadingView());
    final e = _error;
    Field field(String key, String label, {bool optional = true, int lines = 1, TextInputType? kb, String? helper}) =>
        Field(label: label, controller: _c[key]!, optional: optional, maxLines: lines, keyboard: kb, helper: helper, error: e?.field(key));
    const numKb = TextInputType.numberWithOptions(decimal: true);
    String v(String k) => _raw.s(k).isEmpty ? 'Not set' : _raw.s(k);

    Widget section(String id, String title, {String? subtitle, required Widget read, required Widget edit}) {
      final open = _editing == id;
      return SectionCard(
        title: title,
        subtitle: subtitle,
        trailing: open
            ? null
            : TextButton.icon(
                onPressed: _editing != null ? null : () => setState(() => _editing = id),
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: const Text('Edit'),
              ),
        child: open
            ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (e != null && e.fieldErrors.isNotEmpty) const Notice('Please fix the highlighted fields.', tone: Tone.bad),
                edit,
                gap8,
                Row(children: [
                  Expanded(child: BusyButton(label: 'Save', onPressed: _saveSection)),
                  gap8,
                  TextButton(
                    onPressed: () => setState(() {
                      _reset();
                      _error = null;
                      _editing = null;
                    }),
                    child: const Text('Cancel'),
                  ),
                ]),
              ])
            : read,
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(padding: pagePadding, children: [
        section(
          'company',
          'Company',
          subtitle: 'Printed on quotations, invoices and packing lists',
          read: kv([
            ('Company name', v('companyName')),
            ('Chinese name', v('companyNameLocal')),
            ('Address', v('companyAddress')),
            ('Phone', v('companyPhone')),
            ('Email', [_raw.s('companyEmail'), _raw.s('companyEmail2')].where((e) => e.isNotEmpty).join('\n').ifEmptyNotSet),
            ('Website', v('companyWebsite')),
            ('Tax / Reg. no.', v('companyTaxNo')),
            ('Bank details', v('bankDetails')),
          ]),
          edit: Column(children: [
            field('companyName', 'Company name', optional: false),
            field('companyNameLocal', 'Chinese name', helper: 'Printed above the English name'),
            field('companyAddress', 'Address', lines: 3),
            field('companyPhone', 'Phone', kb: TextInputType.phone),
            field('companyEmail', 'Email', kb: TextInputType.emailAddress),
            field('companyEmail2', 'Second email', kb: TextInputType.emailAddress),
            field('companyWebsite', 'Website', kb: TextInputType.url),
            field('companyTaxNo', 'Tax / Reg. no.'),
            field('bankDetails', 'Bank details for T/T', lines: 5, helper: 'Printed on quotations and invoices'),
          ]),
        ),
        section(
          'vat',
          'VAT',
          subtitle: 'The one tax on every quotation and invoice. VAT-exempt customers get none; sent documents keep theirs.',
          read: kv([
            ('VAT rate', '${v('vatRate')}%'),
            ('Our prices', _raw.b('pricesIncludeVat') ? 'Include VAT' : 'Exclude VAT (added on top)'),
          ]),
          edit: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            field('vatRate', 'VAT rate (%)', optional: false, kb: numKb, helper: '0 if you charge no VAT'),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Our prices include VAT'),
              subtitle: Text(_vatIncluded ? 'The price is the total; the VAT inside it is shown' : 'VAT is added on top of the prices'),
              value: _vatIncluded,
              onChanged: (v) => setState(() => _vatIncluded = v),
            ),
          ]),
        ),
        section(
          'defaults',
          'Defaults',
          subtitle: 'For new quotations and invoices. Sent documents keep their own currency.',
          read: kv([
            ('Currency', v('currency')),
            ('Quotation valid', '${v('quotationValidityDays')} days'),
            ('Payment due', '${v('invoicePaymentDays')} days'),
            ('Exchange rates', _raw.m('exchangeRates').isEmpty ? 'Not set' : _raw.m('exchangeRates').entries.map((r) => '1 ${v('currency')} = ${r.value} ${r.key}').join('\n')),
            ('Default margin', '${v('defaultMarginPercent')}% of the selling price'),
            ('Quotation terms', v('defaultQuotationTerms')),
            ('Invoice footer', v('invoiceFooter')),
          ]),
          edit: Column(children: [
            field('currency', 'Currency', optional: false),
            Row(children: [
              Expanded(child: field('quotationValidityDays', 'Quotation valid (days)', optional: false, kb: TextInputType.number)),
              gap12,
              Expanded(child: field('invoicePaymentDays', 'Payment due (days)', optional: false, kb: TextInputType.number)),
            ]),
            field('exchangeRates', 'Exchange rates', optional: false, lines: 3, helper: 'For factory prices: how much one ${v('currency')} buys, one per line, e.g. CNY = 7.10'),
            field('defaultMarginPercent', 'Default margin (%)', optional: false, kb: numKb, helper: 'Of the selling price, when pricing from factory offers'),
            field('defaultQuotationTerms', 'Default quotation terms', lines: 6),
            field('invoiceFooter', 'Invoice footer', lines: 2),
          ]),
        ),
        section(
          'reminders',
          'Reminders',
          subtitle: 'When the system reminds people about waiting work',
          read: kv([
            ('Pending for', '${v('reminderPendingDays')} days'),
            ('Processing for', '${v('reminderProcessingDays')} days'),
            ('Warn before deadlines', '${v('reminderDueSoonDays')} days'),
          ]),
          edit: Column(children: [
            field('reminderPendingDays', 'Pending for (days)', optional: false, kb: TextInputType.number),
            field('reminderProcessingDays', 'Processing for (days)', optional: false, kb: TextInputType.number),
            field('reminderDueSoonDays', 'Due within (days)', optional: false, kb: TextInputType.number),
          ]),
        ),
        section(
          'categories',
          'Sourcing categories',
          subtitle: 'Keep these the same as the dropdown on keboint.com',
          read: Wrap(spacing: 6, runSpacing: 6, children: [for (final c in _raw.ls('categories')) ToneBadge(c, tone: Tone.outline)]),
          edit: field('categories', 'One category per line', optional: false, lines: 10),
        ),
        section(
          'email',
          'Email notifications',
          read: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            kv([('Admin emails', _raw.ls('notifyEmails').isEmpty ? 'Not set' : _raw.ls('notifyEmails').join(', '))]),
            gap8,
            for (final s in _switches.entries)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [
                  Icon(_raw.b(s.key) ? Icons.check_circle_rounded : Icons.remove_circle_outline_rounded, size: 18, color: _raw.b(s.key) ? context.c.ok : context.c.muted),
                  gap8,
                  Expanded(child: Text(s.value, style: context.t.bodyMedium!.copyWith(color: _raw.b(s.key) ? null : context.c.muted))),
                ]),
              ),
            gap8,
            BusyButton(
              label: 'Send a test email',
              style: BusyStyle.outlined,
              onPressed: () async {
                final res = await ref.read(apiProvider).post('/api/v1/settings/test-email', {'notifyEmails': _raw.ls('notifyEmails')});
                if (context.mounted) toast(context, res.s('message', 'Sent'));
              },
            ),
          ]),
          edit: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            field('notifyEmails', 'Admin emails', lines: 2, kb: TextInputType.emailAddress, helper: 'Separate with commas'),
            for (final s in _switches.entries)
              SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(s.value, style: context.t.bodyMedium), value: _on[s.key] ?? false, onChanged: (v) => setState(() => _on[s.key] = v)),
          ]),
        ),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Audit */

class AuditScreen extends ConsumerStatefulWidget {
  const AuditScreen({super.key});
  @override
  ConsumerState<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends ConsumerState<AuditScreen> {
  String _type = '';
  String _who = '';
  List<Json> _types = [];
  List<Json> _people = [];

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final api = ref.read(apiProvider);
    final query = {'type': _type, 'who': _who};
    return Scaffold(
      appBar: AppBar(title: const Text('Audit log'), actions: [
        PopupMenuButton<String>(
          tooltip: 'Person',
          icon: Badge(isLabelVisible: _who.isNotEmpty, child: const Icon(Icons.person_search_outlined)),
          onSelected: (v) => setState(() => _who = v),
          itemBuilder: (_) => [const PopupMenuItem(value: '', child: Text('Everyone')), for (final p in _people) PopupMenuItem(value: p.s('id'), child: Text(p.s('name')))],
        ),
      ]),
      body: PagedList(
        key: ValueKey('$version|$query'),
        load: (page) => api.get('/api/v1/audit', query: {...query, 'page': page}),
        onLoaded: (res) => WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _types.isEmpty) setState(() => (_types = res.l('types'), _people = res.l('people')));
        }),
        header: [
          gap8,
          ChoiceChips<String>(value: _type, onChanged: (v) => setState(() => _type = v), options: [('', 'All'), for (final t in _types) (t.s('value'), t.s('label'))]),
          gap12,
        ],
        empty: const EmptyState(icon: Icons.history_rounded, title: 'Nothing recorded for this filter'),
        itemBuilder: (context, r) => Padding(
          padding: const EdgeInsets.all(14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Avatar(r.s('userName', 'System'), size: 28),
            gap12,
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(TextSpan(children: [
                  TextSpan(text: r.s('userName', 'System'), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                  TextSpan(text: '  ${r.s('summary', r.s('action'))}', style: context.t.bodyMedium!.copyWith(color: context.c.text2)),
                ])),
                const SizedBox(height: 2),
                Text(f.dateTime(r.s('createdAt')), style: context.t.bodySmall),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

extension on String {
  String get ifEmptyNotSet => isEmpty ? 'Not set' : this;
}
