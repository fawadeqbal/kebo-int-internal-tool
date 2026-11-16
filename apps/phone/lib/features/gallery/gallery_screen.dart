import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../app/app.dart';
import '../../design/design.dart';

final _versionProvider = FutureProvider<String>((ref) async {
  final info = await PackageInfo.fromPlatform();
  return '${info.version} (${info.buildNumber})';
});

/// The design system on the phone: every component in every state, in light and dark,
/// so each step can be reviewed on a real device before screens are built from it.
class GalleryScreen extends ConsumerStatefulWidget {
  const GalleryScreen({super.key});

  @override
  ConsumerState<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends ConsumerState<GalleryScreen> {
  bool _loading = false;
  int _successKey = 0;
  bool _celebrate = false;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final mode = ref.watch(themeModeProvider);
    final dark =
        mode == ThemeMode.dark ||
        (mode == ThemeMode.system && MediaQuery.platformBrightnessOf(context) == Brightness.dark);
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Container(
                color: c.brandSurface,
                padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s3, KSpace.s2, KSpace.s6),
                child: DefaultTextStyle(
                  style: KType.body.copyWith(color: c.onBrandSurface),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Kestrel · design gallery',
                              style: KType.label.copyWith(color: c.onBrandSurfaceMuted),
                            ),
                          ),
                          KIconButton(
                            dark ? KIcons.moon : KIcons.moon,
                            label: dark ? 'Switch to light' : 'Switch to dark',
                            color: c.onBrandSurface,
                            onPressed: () =>
                                ref.read(themeModeProvider.notifier).set(dark ? ThemeMode.light : ThemeMode.dark),
                          ),
                        ],
                      ),
                      Text(greeting(DateTime.now(), 'Fawad'), style: KType.title1.copyWith(color: c.onBrandSurface)),
                      const SizedBox(height: KSpace.s1),
                      Text(
                        'Every part of the app, before the app.',
                        style: KType.callout.copyWith(color: c.onBrandSurfaceMuted),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.all(KSpace.s4),
              sliver: SliverList.list(
                children: [
                  _Section('Moments', [
                    Row(
                      children: [
                        SuccessCheck(key: ValueKey(_successKey), label: 'Payment sent for verification'),
                        const SizedBox(width: KSpace.s4),
                        Expanded(
                          child: KButton(
                            'Play again',
                            variant: KButtonVariant.secondary,
                            icon: KIcons.refresh,
                            onPressed: () => setState(() => _successKey++),
                          ),
                        ),
                      ],
                    ),
                    Celebrate(
                      play: _celebrate,
                      child: KButton(
                        'Mark deal as won',
                        icon: KIcons.success,
                        fullWidth: true,
                        onPressed: () {
                          setState(() => _celebrate = false);
                          WidgetsBinding.instance.addPostFrameCallback((_) => setState(() => _celebrate = true));
                        },
                      ),
                    ),
                  ]),
                  _Section('Buttons', [
                    KButton('Place order', size: KButtonSize.lg, fullWidth: true, onPressed: () {}),
                    Wrap(
                      spacing: KSpace.s2,
                      runSpacing: KSpace.s2,
                      children: [
                        KButton('Edit', variant: KButtonVariant.secondary, icon: KIcons.edit, onPressed: () {}),
                        KButton('Skip for now', variant: KButtonVariant.tertiary, onPressed: () {}),
                        KButton('Delete', variant: KButtonVariant.danger, onPressed: () {}),
                        KButton(
                          _loading ? 'Saving' : 'Save',
                          loading: _loading,
                          onPressed: () async {
                            setState(() => _loading = true);
                            await Future<void>.delayed(const Duration(seconds: 2));
                            if (mounted) setState(() => _loading = false);
                          },
                        ),
                        const KButton('Continue', onPressed: null),
                      ],
                    ),
                  ]),
                  _Section('Icon buttons', [
                    Wrap(
                      spacing: KSpace.s1,
                      children: [
                        KIconButton(KIcons.back, label: 'Back', onPressed: () {}),
                        KIconButton(KIcons.bell, label: 'Notifications', badge: 3, onPressed: () {}),
                        KIconButton(KIcons.heart, label: 'Save', selected: true, onPressed: () {}),
                        KIconButton(KIcons.plus, label: 'Add', variant: KIconButtonVariant.filled, onPressed: () {}),
                        KIconButton(
                          KIcons.sliders,
                          label: 'Filters',
                          variant: KIconButtonVariant.tonal,
                          onPressed: () {},
                        ),
                        KIconButton(
                          KIcons.more,
                          label: 'More options',
                          variant: KIconButtonVariant.outlined,
                          onPressed: () {},
                        ),
                      ],
                    ),
                  ]),
                  const _Section('Badges', [
                    Wrap(
                      spacing: KSpace.s2,
                      runSpacing: KSpace.s2,
                      children: [
                        KBadge('Draft'),
                        KBadge('Pro', tone: KTone.brand),
                        KBadge('New', tone: KTone.accent),
                        KBadge('Delivered', tone: KTone.success),
                        KBadge('Delayed', tone: KTone.warning),
                        KBadge('Failed', tone: KTone.danger),
                        KBadge('In transit', tone: KTone.info),
                        KBadge.internal(),
                      ],
                    ),
                  ]),
                  const _Section('Avatars', [
                    Wrap(
                      spacing: KSpace.s3,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        KAvatar('Ali Raza', size: KAvatarSize.sm),
                        KAvatar('Sara Khan', presence: KPresence.online),
                        KAvatar('Kabul Medical Supplies', size: KAvatarSize.lg, presence: KPresence.away),
                      ],
                    ),
                  ]),
                  _Section('Banners', [
                    KBanner('Deliveries may be slower this week due to weather.', onDismiss: () {}),
                    const KBanner('Your receipt was emailed to you.', tone: KTone.success, title: 'Payment received'),
                    KBanner(
                      'Showing figures from 08:42.',
                      tone: KTone.warning,
                      title: "You're offline",
                      actionLabel: 'Try again',
                      onAction: () {},
                    ),
                    const KBanner(
                      "The bank won't release the balance until the certificate of origin is in.",
                      tone: KTone.danger,
                      title: '1 paper is blocking',
                    ),
                  ]),
                  const _Section('Loading', [
                    Row(
                      children: [
                        KSkeleton.circle(),
                        SizedBox(width: KSpace.s3),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              KSkeleton.title(),
                              SizedBox(height: KSpace.s2),
                              KSkeleton(width: 220),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ]),
                  _Section('Icons', [
                    Wrap(
                      spacing: KSpace.s2,
                      runSpacing: KSpace.s2,
                      children: [
                        for (final i in _allIcons)
                          Tooltip(
                            message: i.name,
                            child: Container(
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                color: c.surface,
                                borderRadius: BorderRadius.circular(KRadius.md),
                                border: Border.all(color: c.line),
                              ),
                              alignment: Alignment.center,
                              child: KIcon(i, color: c.ink, label: i.name),
                            ),
                          ),
                      ],
                    ),
                  ]),
                  _Section('Colour roles', [
                    Wrap(
                      spacing: KSpace.s2,
                      runSpacing: KSpace.s2,
                      children: [
                        for (final (name, bg, fg) in [
                          ('primary', c.primary, c.onPrimary),
                          ('primary-soft', c.primarySoft, c.onPrimarySoft),
                          ('accent', c.accent, c.onAccent),
                          ('success-soft', c.successSoft, c.onSuccessSoft),
                          ('warning-soft', c.warningSoft, c.onWarningSoft),
                          ('danger', c.danger, c.onDanger),
                          ('info-soft', c.infoSoft, c.onInfoSoft),
                          ('brand-surface', c.brandSurface, c.onBrandSurface),
                        ])
                          Container(
                            width: 104,
                            height: 56,
                            padding: const EdgeInsets.all(KSpace.s2),
                            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(KRadius.sm)),
                            alignment: Alignment.bottomLeft,
                            child: Text(name, style: KType.caption.copyWith(color: fg)),
                          ),
                      ],
                    ),
                  ]),
                  const SizedBox(height: KSpace.s4),
                  Center(
                    child: Text(
                      'RFQ Desk ${ref.watch(_versionProvider).value ?? ''}',
                      style: KType.caption.copyWith(color: c.inkMuted),
                    ),
                  ),
                  const SizedBox(height: KSpace.s8),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

const _allIcons = [
  KIcons.back,
  KIcons.close,
  KIcons.check,
  KIcons.chevron,
  KIcons.plus,
  KIcons.search,
  KIcons.home,
  KIcons.bell,
  KIcons.user,
  KIcons.sliders,
  KIcons.info,
  KIcons.warning,
  KIcons.success,
  KIcons.error,
  KIcons.heart,
  KIcons.more,
  KIcons.trash,
  KIcons.box,
  KIcons.edit,
  KIcons.filter,
  KIcons.camera,
  KIcons.file,
  KIcons.upload,
  KIcons.download,
  KIcons.phone,
  KIcons.chat,
  KIcons.mail,
  KIcons.ship,
  KIcons.wallet,
  KIcons.chart,
  KIcons.calendar,
  KIcons.clock,
  KIcons.logout,
  KIcons.lock,
  KIcons.users,
  KIcons.factory,
  KIcons.refresh,
  KIcons.arrowIn,
  KIcons.arrowOut,
  KIcons.send,
  KIcons.wifiOff,
  KIcons.grid,
  KIcons.globe,
  KIcons.play,
  KIcons.chevronDown,
  KIcons.shield,
  KIcons.moon,
  KIcons.pin,
];

class _Section extends StatelessWidget {
  const _Section(this.title, this.children);

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: KSpace.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text(title, style: KType.title3.copyWith(color: context.k.ink)),
          ),
          const SizedBox(height: KSpace.s3),
          for (final (i, w) in children.indexed) ...[if (i > 0) const SizedBox(height: KSpace.s3), w],
        ],
      ),
    );
  }
}
