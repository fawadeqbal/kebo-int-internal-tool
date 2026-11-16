import 'package:flutter/material.dart';

import '../feel.dart';
import '../icons.dart';
import '../theme.dart';
import 'pressable.dart';

/// Kestrel › TopBar, for pushed screens. Back or close (never both), a compact centred
/// title that names the record *type*, and at most two actions.
class KTopBar extends StatelessWidget implements PreferredSizeWidget {
  const KTopBar({
    super.key,
    required this.title,
    this.leading = KTopBarLeading.back,
    this.onLeading,
    this.actions = const [],
  });

  final String title;
  final KTopBarLeading leading;
  final VoidCallback? onLeading;
  final List<Widget> actions;

  @override
  Size get preferredSize => const Size.fromHeight(KSize.topbar);

  @override
  Widget build(BuildContext context) {
    assert(actions.length <= 2, 'A top bar has at most 2 actions; put the rest in an overflow menu.');
    final c = context.k;
    final canPop = Navigator.of(context).canPop();
    return Material(
      color: c.surface,
      child: SafeArea(
        bottom: false,
        child: Container(
          height: KSize.topbar,
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: c.line)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: KSpace.s1),
          child: Row(
            children: [
              SizedBox(
                width: 96,
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: leading == KTopBarLeading.none || (!canPop && onLeading == null)
                      ? null
                      : Pressable(
                          semanticLabel: leading == KTopBarLeading.close ? 'Close' : 'Back',
                          onPressed: onLeading ?? () => Navigator.of(context).maybePop(),
                          child: KIcon(leading == KTopBarLeading.close ? KIcons.close : KIcons.back, color: c.ink),
                        ),
                ),
              ),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    title,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: KType.title3.copyWith(color: c.ink),
                  ),
                ),
              ),
              SizedBox(
                width: 96,
                child: Row(mainAxisAlignment: MainAxisAlignment.end, children: actions),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum KTopBarLeading { back, close, none }

/// One destination of the [KTabBar].
class KTab {
  const KTab(this.label, this.icon, {this.badge});
  final String label;
  final KIconData icon;
  final int? badge;
}

/// Kestrel › TabBar: 3–5 destinations, icon + label, the current one in a soft pill.
class KTabBar extends StatelessWidget {
  const KTabBar({super.key, required this.tabs, required this.index, required this.onSelect});

  final List<KTab> tabs;
  final int index;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    assert(tabs.length >= 3 && tabs.length <= 5, 'A tab bar has 3–5 tabs.');
    final c = context.k;
    final m = KMotion.of(context);
    return Material(
      color: c.surface,
      child: SafeArea(
        top: false,
        child: Container(
          height: KSize.tabbar,
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: c.line)),
          ),
          child: Row(
            children: [
              for (var i = 0; i < tabs.length; i++)
                Expanded(
                  child: Semantics(
                    container: true,
                    selected: i == index,
                    button: true,
                    label:
                        '${tabs[i].label}${(tabs[i].badge ?? 0) > 0 ? ', ${tabs[i].badge} new' : ''}, tab ${i + 1} of ${tabs.length}',
                    onTap: () => onSelect(i),
                    excludeSemantics: true,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () {
                        KHaptics.tap();
                        onSelect(i);
                      },
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              AnimatedContainer(
                                duration: m.quick,
                                curve: KMotion.standardCurve,
                                width: 56,
                                height: 30,
                                decoration: BoxDecoration(
                                  color: i == index ? c.primarySoft : Colors.transparent,
                                  borderRadius: BorderRadius.circular(KRadius.full),
                                ),
                                child: KIcon(tabs[i].icon, size: 22, color: i == index ? c.primary : c.inkMuted),
                              ),
                              if ((tabs[i].badge ?? 0) > 0)
                                Positioned(
                                  right: 6,
                                  top: -2,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 5),
                                    constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                                    decoration: BoxDecoration(
                                      color: c.danger,
                                      borderRadius: BorderRadius.circular(KRadius.full),
                                      border: Border.all(color: c.surface, width: 2),
                                    ),
                                    alignment: Alignment.center,
                                    child: Text(
                                      tabs[i].badge! > 99 ? '99+' : '${tabs[i].badge}',
                                      style: KType.caption.copyWith(color: c.onDanger, fontWeight: FontWeight.w700),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            tabs[i].label,
                            maxLines: 1,
                            style: KType.labelSm.copyWith(
                              color: i == index ? c.primary : c.inkMuted,
                              fontWeight: i == index ? FontWeight.w600 : FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Kestrel › Fab: the one creation action on a top-level list screen. [label] makes it
/// extended (icon + text) when the icon alone isn't obvious.
class KFab extends StatelessWidget {
  const KFab({super.key, required this.icon, required this.semanticLabel, required this.onPressed, this.label});

  final KIconData icon;
  final String semanticLabel;
  final String? label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Pressable(
      onPressed: onPressed,
      semanticLabel: semanticLabel,
      borderRadius: BorderRadius.circular(KRadius.lg),
      child: Container(
        height: 56,
        constraints: const BoxConstraints(minWidth: 56),
        padding: EdgeInsets.symmetric(horizontal: label == null ? 0 : KSpace.s5),
        decoration: BoxDecoration(
          color: c.primary,
          borderRadius: BorderRadius.circular(KRadius.lg),
          boxShadow: c.elevation2,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            KIcon(icon, color: c.onPrimary),
            if (label != null) ...[
              const SizedBox(width: KSpace.s2),
              Text(label!, style: KType.label.copyWith(color: c.onPrimary)),
            ],
          ],
        ),
      ),
    );
  }
}
