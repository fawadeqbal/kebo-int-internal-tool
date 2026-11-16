import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers.dart';
import '../../../design/design.dart';

/// Step 3: signed in. Home and the five tabs come in step 4; until then this shows who is
/// signed in, the connection, what waits to be sent, and the way to the design gallery.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final me = s.me;
    final c = context.k;
    final now = TimeOfDay.now().format(context);
    return Scaffold(
      backgroundColor: c.bg,
      body: ListenableBuilder(
        listenable: Listenable.merge([s.api.net, s.outbox]),
        builder: (context, _) => ListView(
          padding: EdgeInsets.zero,
          children: [
            KAppHeader(
              brand: true,
              company: me?.company ?? 'RFQ Desk',
              title: greeting(DateTime.now(), (me?.name ?? '').split(' ').first),
              summary: 'Home and the tabs arrive in the next update.',
              sync: s.api.net.offline ? KSyncState.offline(now) : KSyncState.synced(now),
              userName: me?.name ?? '',
              userRole: me?.role ?? '',
            ),
            Padding(
              padding: const EdgeInsets.all(KSpace.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (s.api.net.offline) ...[
                    const KBanner(
                      'No connection. What you save waits on the phone and is sent when you are back.',
                      tone: KTone.warning,
                    ),
                    const SizedBox(height: KSpace.s4),
                  ],
                  KDetails(
                    title: 'Signed in',
                    columns: 1,
                    items: [
                      KDetail('Name', me?.name),
                      KDetail('Email', me?.email),
                      KDetail('Role', me?.role),
                      KDetail('Company', me?.company),
                      KDetail('Server', s.api.server.replaceFirst(RegExp(r'^https?://'), '')),
                      KDetail('Waiting to send', '${s.outbox.waiting}'),
                    ],
                  ),
                  const SizedBox(height: KSpace.s4),
                  KButton(
                    'Design gallery',
                    icon: KIcons.grid,
                    variant: KButtonVariant.secondary,
                    fullWidth: true,
                    onPressed: () => context.push('/gallery'),
                  ),
                  const SizedBox(height: KSpace.s3),
                  KButton(
                    'Sign out',
                    icon: KIcons.logout,
                    variant: KButtonVariant.tertiary,
                    fullWidth: true,
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
          ],
        ),
      ),
    );
  }
}
