import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme.dart';
import 'avatar.dart';
import 'badge.dart';
import 'content.dart';
import 'icon_button.dart';
import 'pressable.dart';

/// Whether the figures on screen are current. Never hidden: stale figures must look stale.
class KSyncState {
  const KSyncState.synced(this.at) : offline = false;
  const KSyncState.offline(this.at) : offline = true;
  final bool offline;

  /// e.g. "9:41".
  final String at;
}

/// Kestrel › AppHeader, for the five tab screens. Answers *where am I, whose data is this,
/// is it current*. [brand] (deep teal band, greeting) is for Home only.
class KAppHeader extends StatelessWidget {
  const KAppHeader({
    super.key,
    required this.company,
    required this.title,
    required this.sync,
    required this.userName,
    required this.userRole,
    this.eyebrow,
    this.summary,
    this.unread = 0,
    this.brand = false,
    this.onCompany,
    this.onSearch,
    this.onBell,
    this.onAccount,
  });

  final String company;
  final String title;
  final String? eyebrow;

  /// A live one-liner from the screen's own figures. Leave it out rather than fill it.
  final String? summary;
  final KSyncState sync;
  final String userName;
  final String userRole;
  final int unread;
  final bool brand;
  final VoidCallback? onCompany;
  final VoidCallback? onSearch;
  final VoidCallback? onBell;
  final VoidCallback? onAccount;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final bg = brand ? c.brandSurface : c.surface;
    final ink = brand ? c.onBrandSurface : c.ink;
    final muted = brand ? c.onBrandSurfaceMuted : c.inkMuted;
    final syncColor = sync.offline
        ? (brand ? c.onBrandSurface : c.warning)
        : (brand ? c.onBrandSurfaceMuted : c.success);

    return Material(
      color: bg,
      child: SafeArea(
        bottom: false,
        child: Container(
          decoration: BoxDecoration(
            border: brand ? null : Border(bottom: BorderSide(color: c.line)),
          ),
          padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s2, KSpace.s2, KSpace.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Pressable(
                      onPressed: onCompany,
                      scale: 0.99,
                      semanticLabel:
                          'Company: $company. ${sync.offline ? 'Offline, figures from ${sync.at}' : 'Synced ${sync.at}'}. Switch company',
                      child: Row(
                        children: [
                          Container(
                            width: 32,
                            height: 32,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: brand ? c.onBrandSurface.withValues(alpha: 0.14) : c.primarySoft,
                              borderRadius: BorderRadius.circular(KRadius.sm),
                            ),
                            child: Text(
                              KAvatar.initials(company),
                              style: KType.labelSm.copyWith(color: brand ? c.onBrandSurface : c.onPrimarySoft),
                            ),
                          ),
                          const SizedBox(width: KSpace.s2),
                          Flexible(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Flexible(
                                      child: Text(
                                        company,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: KType.label.copyWith(color: ink),
                                      ),
                                    ),
                                    KIcon(KIcons.chevronDown, size: 16, color: muted),
                                  ],
                                ),
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    if (sync.offline) ...[
                                      KIcon(KIcons.wifiOff, size: 12, color: syncColor),
                                      const SizedBox(width: 3),
                                    ] else
                                      Container(
                                        width: 6,
                                        height: 6,
                                        margin: const EdgeInsets.only(right: 4),
                                        decoration: BoxDecoration(color: syncColor, shape: BoxShape.circle),
                                      ),
                                    Flexible(
                                      child: Text(
                                        sync.offline ? 'Offline · ${sync.at}' : 'Synced ${sync.at}',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: KType.caption.copyWith(color: syncColor),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  KIconButton(KIcons.search, label: 'Search', color: ink, onPressed: onSearch),
                  KIconButton(KIcons.bell, label: 'Notifications', badge: unread, color: ink, onPressed: onBell),
                  Pressable(
                    onPressed: onAccount,
                    semanticLabel: 'Your account: $userName, $userRole',
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: brand ? c.onBrandSurfaceMuted : c.line, width: 2),
                      ),
                      child: ExcludeSemantics(child: KAvatar(userName, size: KAvatarSize.sm)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KSpace.s4),
              if (eyebrow != null) Text(eyebrow!, style: KType.footnote.copyWith(color: muted)),
              Semantics(
                header: true,
                child: Text(title, style: (brand ? KType.title1 : KType.title2).copyWith(color: ink)),
              ),
              if (summary != null) ...[
                const SizedBox(height: 2),
                Text(summary!, style: KType.callout.copyWith(color: muted)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A key figure in a [KRecordHeader].
class KFigure {
  const KFigure(this.label, this.value, {this.tone});
  final String label;
  final String value;
  final KTone? tone;
}

/// Kestrel › RecordHeader: the identity card at the top of every record. *What is this,
/// whose is it, where does it stand, who touched it last.* Never holds internal-only
/// figures (margin lives in the Internal view).
class KRecordHeader extends StatelessWidget {
  const KRecordHeader({
    super.key,
    required this.type,
    required this.number,
    required this.title,
    this.icon = KIcons.file,
    this.party,
    this.partyAvatar = false,
    this.badges = const [],
    this.figures = const [],
    this.steps,
    this.actions = const [],
    this.updated,
  });

  /// "Sales order".
  final String type;

  /// "SO-2026-0035".
  final String number;
  final String title;
  final KIconData icon;

  /// Who it is with or for.
  final String? party;

  /// Show the party's avatar instead of the type icon (partner records).
  final bool partyAvatar;
  final List<KBadge> badges;
  final List<KFigure> figures;
  final KSteps? steps;
  final List<Widget> actions;

  /// "Updated 8 Nov by Bilal · departed Qingdao".
  final String? updated;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    const tabular = [FontFeature.tabularFigures()];
    return Container(
      color: c.surface,
      padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s4, KSpace.s4, KSpace.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (partyAvatar && party != null)
                KAvatar(party!, size: KAvatarSize.md)
              else
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: c.primarySoft, borderRadius: BorderRadius.circular(KRadius.md)),
                  child: KIcon(icon, color: c.onPrimarySoft),
                ),
              const SizedBox(width: KSpace.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$type · $number',
                      style: KType.footnote.copyWith(color: c.inkMuted, fontFeatures: tabular),
                    ),
                    Semantics(
                      header: true,
                      child: Text(title, style: KType.title2.copyWith(color: c.ink)),
                    ),
                    if (party != null && !partyAvatar) Text(party!, style: KType.callout.copyWith(color: c.inkMuted)),
                  ],
                ),
              ),
            ],
          ),
          if (badges.isNotEmpty) ...[
            const SizedBox(height: KSpace.s3),
            Wrap(spacing: KSpace.s2, runSpacing: KSpace.s2, children: badges),
          ],
          if (figures.isNotEmpty) ...[
            const SizedBox(height: KSpace.s3),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: KSpace.s3, vertical: KSpace.s2),
              decoration: BoxDecoration(color: c.surfaceSunken, borderRadius: BorderRadius.circular(KRadius.md)),
              child: Wrap(
                spacing: KSpace.s5,
                runSpacing: KSpace.s2,
                children: [
                  for (final f in figures)
                    MergeSemantics(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(f.label, style: KType.caption.copyWith(color: c.inkMuted)),
                          Text(
                            f.value,
                            style: KType.bodyStrong.copyWith(
                              fontFeatures: tabular,
                              color: switch (f.tone) {
                                KTone.success => c.success,
                                KTone.danger => c.danger,
                                KTone.warning => c.warning,
                                _ => c.ink,
                              },
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (steps != null) ...[const SizedBox(height: KSpace.s3), steps!],
          if (actions.isNotEmpty) ...[
            const SizedBox(height: KSpace.s3),
            Row(
              children: [
                for (final a in actions)
                  Expanded(
                    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: a),
                  ),
              ],
            ),
          ],
          if (updated != null) ...[
            const SizedBox(height: KSpace.s3),
            Row(
              children: [
                KIcon(KIcons.clock, size: 14, color: c.inkMuted),
                const SizedBox(width: KSpace.s1),
                Expanded(
                  child: Text(updated!, style: KType.footnote.copyWith(color: c.inkMuted)),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
