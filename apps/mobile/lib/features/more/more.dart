import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/session.dart';
import '../../ui/kit.dart';
import '../shell/shell.dart';

/// Everything that isn't a bottom tab.
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
    final onWeb = [
      'Factory prices and quotation editing',
      'Recording payments and correcting order dates',
      if (s.can('reports.view')) 'Reports',
      if (s.can('users.manage') || s.can('settings.manage')) 'Users, settings and the audit log',
    ];
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
                    Text('${s.user.s('email')} · ${roleLabel[s.role] ?? s.role}', style: context.t.bodySmall),
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
            item(Icons.lock_outline_rounded, 'My account', '/account', sub: 'Password and two-step sign-in'),
          ]),
        ),
        const Overline('On the web'),
        WebNote('Use the web app for: ${onWeb.join('; ')}. The phone follows the same inquiries and orders, moves orders through their stages and opens their PDFs.'),
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
            if (await confirm(context, title: 'Sign out?', message: 'This phone is signed out and stops getting notifications. Your other devices stay signed in.', action: 'Sign out')) {
              await ref.read(sessionProvider.notifier).signOut();
            }
          },
          icon: Icon(Icons.logout_rounded, size: 18, color: context.c.bad),
          label: Text('Sign out', style: TextStyle(color: context.c.bad)),
        ),
        gap16,
        Center(child: Text('Kebo 2.0 · ${Uri.tryParse(server)?.host ?? server}', style: context.t.bodySmall)),
      ]),
    );
  }
}
