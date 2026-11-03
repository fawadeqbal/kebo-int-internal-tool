import 'package:flutter/material.dart' hide Badge;
import 'package:url_launcher/url_launcher.dart';

import 'format.dart';
import 'theme.dart';
import 'tone.dart';

/// A status label: words always, colour as a second signal.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.badge, {super.key});
  final Badge badge;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: c.soft(badge.tone), borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (badge.tone != Tone.neutral) ...[
          Container(width: 6, height: 6, decoration: BoxDecoration(color: c.fg(badge.tone), shape: BoxShape.circle)),
          const SizedBox(width: 6),
        ],
        Text(badge.label, style: context.text.labelSmall?.copyWith(color: c.fg(badge.tone))),
      ]),
    );
  }
}

/// A titled card: the one container used for every section on every screen.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, required this.child, this.action, this.count});
  final String title;
  final int? count;
  final Widget? action;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(Gap.radius), border: Border.all(color: c.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.sm, Gap.sm, Gap.sm),
          child: Row(children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Text(count == null ? title : '$title · $count', style: context.text.titleMedium),
              ),
            ),
            ?action,
            if (action == null) const SizedBox(height: Gap.tap - Gap.sm * 2),
          ]),
        ),
        Divider(height: 1, color: c.line),
        Padding(padding: const EdgeInsets.symmetric(horizontal: Gap.lg, vertical: Gap.xs), child: child),
      ]),
    );
  }
}

/// A label and its value on one line; long values wrap under the label.
class KvRow extends StatelessWidget {
  const KvRow(this.label, this.value, {super.key});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.sm),
        child: value.length > 32 || value.contains('\n')
            ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(label, style: context.text.bodySmall?.copyWith(color: c.text2)),
                const SizedBox(height: 2),
                Text(value, style: context.text.bodyMedium),
              ])
            : Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text(label, style: context.text.bodySmall?.copyWith(color: c.text2))),
                const SizedBox(width: Gap.md),
                Flexible(flex: 2, child: Text(value, textAlign: TextAlign.right, style: context.text.bodyMedium?.copyWith(fontWeight: FontWeight.w500))),
              ]),
      ),
    );
  }
}

/// Call, WhatsApp or email a contact; hidden when there is no number or address.
class ContactAction {
  const ContactAction._(this.kind, this.value, this.icon, this.label);
  factory ContactAction.phone(String? v) => ContactAction._('phone', v, Icons.call_outlined, 'Call');
  factory ContactAction.whatsapp(String? v) => ContactAction._('whatsapp', v, Icons.chat_outlined, 'WhatsApp');
  factory ContactAction.email(String? v) => ContactAction._('email', v, Icons.mail_outline, 'Email');

  final String kind;
  final String? value;
  final IconData icon;
  final String label;

  bool get usable => value != null && value!.trim().isNotEmpty;

  Uri get uri => switch (kind) {
        'phone' => Uri(scheme: 'tel', path: value!.replaceAll(RegExp(r'[^\d+]'), '')),
        'whatsapp' => Uri.parse('https://wa.me/${value!.replaceAll(RegExp(r'\D'), '')}'),
        _ => Uri(scheme: 'mailto', path: value!.trim()),
      };

  Future<void> open() => launchUrl(uri, mode: LaunchMode.externalApplication);
}

/// What a row shows. Built by the generated screens from the spec.
class RowData {
  const RowData(
      {required this.title,
      this.sub = const [],
      this.badge,
      this.value,
      this.actions = const [],
      this.onTap,
      this.tone,
      this.trailing,
      this.leading,
      this.strong = false});

  /// An icon before the text (a checklist state, a file kind).
  final Widget? leading;
  final String? title;

  /// A coloured mark at the start: how urgent it is (late, due soon…).
  final Tone? tone;

  /// A small button at the end, e.g. "Open".
  final Widget? trailing;

  /// Unread or new: the title in bold.
  final bool strong;
  final List<String?> sub;
  final Badge? badge;
  final String? value;
  final List<ContactAction> actions;
  final VoidCallback? onTap;
}

/// One row of a list: title, a line of details, a status and a value. Tap opens it.
class PhoneRow extends StatelessWidget {
  const PhoneRow(this.data, {super.key, this.divider = true});
  final RowData data;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final sub = joinParts(data.sub);
    final actions = data.actions.where((a) => a.usable).toList();
    final body = Padding(
      padding: const EdgeInsets.symmetric(vertical: Gap.md),
      child: Row(children: [
        if (data.leading != null) ...[data.leading!, const SizedBox(width: Gap.md)],
        if (data.tone != null) ...[
          ExcludeSemantics(
            child: Container(width: 8, height: 8, decoration: BoxDecoration(color: c.fg(data.tone!), shape: BoxShape.circle)),
          ),
          const SizedBox(width: Gap.md),
        ],
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(data.title ?? '',
                style: data.strong ? context.text.titleSmall?.copyWith(fontWeight: FontWeight.w700) : context.text.titleSmall,
                maxLines: 2,
                overflow: TextOverflow.ellipsis),
            if (sub.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(sub, style: context.text.bodySmall?.copyWith(color: c.text2), maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
          ]),
        ),
        if (data.badge != null || data.value != null) ...[
          const SizedBox(width: Gap.sm),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (data.badge != null) StatusBadge(data.badge!),
            if (data.value != null) ...[
              if (data.badge != null) const SizedBox(height: 4),
              Text(data.value!, style: context.text.bodySmall?.copyWith(color: c.text2, fontFeatures: const [FontFeature.tabularFigures()])),
            ],
          ]),
        ],
        if (data.trailing != null) ...[const SizedBox(width: Gap.sm), data.trailing!]
        else if (data.onTap != null) ...[
          const SizedBox(width: Gap.xs),
          Icon(Icons.chevron_right, color: c.muted, size: 20),
        ],
      ]),
    );
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Row(children: [
        Expanded(
          child: data.onTap == null
              ? MergeSemantics(child: body)
              : MergeSemantics(child: Semantics(button: true, child: InkWell(onTap: data.onTap, child: body))),
        ),
        for (final a in actions)
          IconButton(icon: Icon(a.icon), tooltip: '${a.label} ${data.title ?? ''}'.trim(), onPressed: a.open),
      ]),
      if (divider) Divider(height: 1, color: c.line),
    ]);
  }
}

/// Nothing to show yet, with what to do about it.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.text, this.action});
  final String title;
  final String? text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Gap.xl, horizontal: Gap.lg),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(title, textAlign: TextAlign.center, style: context.text.titleSmall),
        if (text != null) ...[
          const SizedBox(height: Gap.xs),
          Text(text!, textAlign: TextAlign.center, style: context.text.bodySmall?.copyWith(color: c.text2)),
        ],
        if (action != null) ...[const SizedBox(height: Gap.md), action!],
      ]),
    );
  }
}

/// A message across the top of a screen or a sheet.
class MessageBanner extends StatelessWidget {
  const MessageBanner(this.text, {super.key, this.tone = Tone.info, this.action});
  final String text;
  final Tone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: Gap.md, vertical: Gap.sm),
        decoration: BoxDecoration(color: c.soft(tone), borderRadius: BorderRadius.circular(Gap.radiusSm)),
        child: Row(children: [
          Expanded(child: Text(text, style: context.text.bodySmall?.copyWith(color: c.fg(tone)))),
          ?action,
        ]),
      ),
    );
  }
}

/// Could not load: why, and a way to try again.
class ErrorView extends StatelessWidget {
  const ErrorView(this.message, {super.key, required this.retry});
  final String message;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context) => Center(
        child: EmptyState(
          title: 'Could not load',
          text: message,
          action: OutlinedButton(onPressed: retry, child: const Text('Try again')),
        ),
      );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) =>
      Center(child: Semantics(label: 'Loading', child: const CircularProgressIndicator()));
}

/// A short note at the bottom of the screen after something happened.
void toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Asks before something that cannot be undone. True when confirmed.
Future<bool> confirmDialog(BuildContext context, {required String title, String? text, required String yes, bool danger = false}) async {
  final c = context.colors;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title, style: ctx.text.titleMedium),
      content: text == null ? null : Text(text, style: ctx.text.bodyMedium),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text('Cancel', style: TextStyle(color: c.text2))),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: c.badSolid) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(yes),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// The search box at the top of a list.
class SearchField extends StatelessWidget {
  const SearchField({super.key, required this.hint, required this.onChanged, this.controller});
  final String hint;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        onChanged: onChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: hint,
          prefixIcon: Icon(Icons.search, color: context.colors.muted),
          contentPadding: const EdgeInsets.symmetric(vertical: Gap.md),
        ),
      );
}
