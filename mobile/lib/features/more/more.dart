import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/json.dart';
import '../../core/session.dart';
import '../../ui/kit.dart';
import '../shell/shell.dart';

/// Everything that isn't a bottom tab, shown by role (same permissions as the web's sidebar).
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final mode = ref.watch(themeModeProvider);
    final server = ref.read(apiProvider).baseUrl;
    Widget item(IconData icon, String label, String route, {String? sub}) => RowTile(
          leading: Icon(icon, color: context.c.primary, size: 22),
          title: label,
          subtitle: sub == null ? null : Text(sub),
          onTap: () => context.push(route),
        );
    return Scaffold(
      appBar: tabBar(context, 'More'),
      body: ListView(padding: pagePadding, children: [
        Card(
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => context.push('/account'),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(children: [
                Avatar(s.user.s('name'), size: 46),
                gap12,
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(s.user.s('name'), style: context.t.titleMedium),
                    Text('${s.user.s('email')} · ${s.me?.m('user').s('roleLabel') ?? ''}', style: context.t.bodySmall),
                  ]),
                ),
                Icon(Icons.chevron_right_rounded, color: context.c.muted),
              ]),
            ),
          ),
        ),
        const Overline('Work'),
        Card(
          clipBehavior: Clip.antiAlias,
          child: CardList(children: [
            item(Icons.notifications_none_rounded, 'Notifications', '/notifications'),
            if (s.can('sourcing.manage')) item(Icons.factory_outlined, 'Factories', '/factories', sub: 'Who you buy from, their offers and VAT'),
            if (s.can('invoices.manage')) item(Icons.receipt_long_outlined, 'Invoices', '/invoices', sub: 'Payments, balances and packing lists'),
            if (s.can('reports.view')) item(Icons.insights_rounded, 'Reports', '/reports', sub: 'Conversion, money, team, trends'),
          ]),
        ),
        if (s.can('users.manage') || s.can('settings.manage') || s.can('audit.view')) ...[
          const Overline('Administration'),
          Card(
            clipBehavior: Clip.antiAlias,
            child: CardList(children: [
              if (s.can('users.manage')) item(Icons.manage_accounts_outlined, 'Users', '/users', sub: 'Accounts, roles, passwords, two-step'),
              if (s.can('settings.manage')) item(Icons.settings_outlined, 'Settings', '/settings', sub: 'Company, bank details, categories, emails'),
              if (s.can('audit.view')) item(Icons.history_rounded, 'Audit log', '/audit', sub: 'Who changed what, and when'),
            ]),
          ),
        ],
        const Overline('App'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Appearance', style: context.t.titleSmall),
              gap8,
              SizedBox(
                width: double.infinity,
                child: SegmentedButton<ThemeMode>(
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: ThemeMode.system, label: Text('System'), icon: Icon(Icons.brightness_auto_outlined, size: 18)),
                    ButtonSegment(value: ThemeMode.light, label: Text('Light'), icon: Icon(Icons.light_mode_outlined, size: 18)),
                    ButtonSegment(value: ThemeMode.dark, label: Text('Dark'), icon: Icon(Icons.dark_mode_outlined, size: 18)),
                  ],
                  selected: {mode},
                  onSelectionChanged: (v) => ref.read(themeModeProvider.notifier).set(v.first),
                ),
              ),
            ]),
          ),
        ),
        gap12,
        OutlinedButton.icon(
          onPressed: () async {
            if (await confirm(context, title: 'Sign out?', message: 'This phone is signed out. Your other devices stay signed in.', action: 'Sign out')) {
              await ref.read(sessionProvider.notifier).signOut();
            }
          },
          icon: Icon(Icons.logout_rounded, size: 18, color: context.c.bad),
          label: Text('Sign out', style: TextStyle(color: context.c.bad)),
        ),
        gap16,
        Center(child: Text('Kebo RFQ Desk 1.0 · ${Uri.tryParse(server)?.host ?? server}', style: context.t.bodySmall)),
      ]),
    );
  }
}
