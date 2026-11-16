import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../../app/app.dart';
import '../../../app/tab_header.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';

/// More: you and your company, how the app looks, what waits on the phone, and signing out.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final me = s.me;
    final mode = ref.watch(themeModeProvider);
    return Scaffold(
      backgroundColor: context.k.bg,
      body: ListView(
        padding: EdgeInsets.zero,
        children: [
          const TabHeader(title: 'More'),
          Padding(
            padding: const EdgeInsets.all(KSpace.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                KCard(
                  child: Row(
                    children: [
                      KAvatar(me?.name ?? '?', size: KAvatarSize.lg),
                      const SizedBox(width: KSpace.s4),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(me?.name ?? '', style: KType.title3.copyWith(color: context.k.ink)),
                            Text(me?.email ?? '', style: KType.callout.copyWith(color: context.k.inkMuted)),
                            const SizedBox(height: KSpace.s2),
                            Wrap(
                              spacing: KSpace.s2,
                              children: [
                                if (me?.role != null) KBadge(me!.role!, tone: KTone.brand, showToneIcon: false),
                                if (me?.company != null) KBadge(me!.company!),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Appearance',
                  children: [
                    KSegmented<ThemeMode>(
                      value: mode,
                      onChanged: (m) => ref.read(themeModeProvider.notifier).set(m),
                      segments: const [
                        (ThemeMode.system, 'Phone'),
                        (ThemeMode.light, 'Light'),
                        (ThemeMode.dark, 'Dark'),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: KSpace.s6),
                ListenableBuilder(
                  listenable: Listenable.merge([s.outbox, s.api.net]),
                  builder: (context, _) => KDetails(
                    title: 'This phone',
                    columns: 1,
                    items: [
                      KDetail('Connection', s.api.net.offline ? 'Offline' : 'Online'),
                      KDetail('Waiting to send', s.outbox.waiting == 0 ? 'Nothing' : '${s.outbox.waiting}'),
                      KDetail('Server', s.api.server.replaceFirst(RegExp(r'^https?://'), '')),
                    ],
                  ),
                ),
                const SizedBox(height: KSpace.s6),
                KCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      KListItem(
                        leading: KIcon(KIcons.users, color: context.k.inkMuted),
                        title: 'Customers and factories',
                        subtitle: 'Who they are, how to reach them, their deals',
                        onPressed: () => context.push('/partners'),
                      ),
                      KListItem(
                        leading: KIcon(KIcons.grid, color: context.k.inkMuted),
                        title: 'Design gallery',
                        subtitle: 'Every Kestrel component, for review',
                        onPressed: () => context.push('/gallery'),
                      ),
                      KListItem(
                        leading: KIcon(KIcons.logout, color: context.k.danger),
                        title: 'Sign out',
                        divider: false,
                        chevron: false,
                        onPressed: () async {
                          final ok =
                              s.outbox.waiting == 0 ||
                              (await showKConfirm(
                                    context,
                                    title: 'Sign out with ${s.outbox.waiting} unsent?',
                                    message: 'They are on this phone only. Signing out deletes them.',
                                    confirmLabel: 'Sign out',
                                    destructive: true,
                                  ) ==
                                  true);
                          if (ok) await s.signOut();
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: KSpace.s6),
                FutureBuilder(
                  future: PackageInfo.fromPlatform(),
                  builder: (context, snap) => Text(
                    snap.hasData ? 'RFQ Desk ${snap.data!.version} (build ${snap.data!.buildNumber})' : 'RFQ Desk',
                    textAlign: TextAlign.center,
                    style: KType.footnote.copyWith(color: context.k.inkMuted),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
