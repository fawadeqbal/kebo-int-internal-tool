import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/format.dart' as f;
import '../core/labels.dart';
import '../theme/colors.dart';

/// Shared building blocks, styled like the web's Vibe components.

const gap4 = SizedBox(height: 4, width: 4);
const gap8 = SizedBox(height: 8, width: 8);
const gap12 = SizedBox(height: 12, width: 12);
const gap16 = SizedBox(height: 16, width: 16);
const gap24 = SizedBox(height: 24, width: 24);
const pagePadding = EdgeInsets.fromLTRB(16, 12, 16, 32);

extension Ctx on BuildContext {
  AppColors get c => AppColors.of(this);
  TextTheme get t => Theme.of(this).textTheme;
}

/* ---------------------------------------------------------------- Cards */

/// A card with an optional header row (title, subtitle, action), like the web's Card + CardHeader.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, this.subtitle, this.trailing, required this.child, this.padding = const EdgeInsets.all(16), this.margin = const EdgeInsets.only(bottom: 12)});
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (title != null)
              Container(
                padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
                decoration: BoxDecoration(border: Border(bottom: BorderSide(color: context.c.line))),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(title!, style: context.t.titleSmall),
                          if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(subtitle!, style: context.t.bodySmall)),
                        ],
                      ),
                    ),
                    ?trailing,
                  ],
                ),
              ),
            Padding(padding: padding, child: child),
          ],
        ),
      ),
    );
  }
}

/// Divided list inside a card.
class CardList extends StatelessWidget {
  const CardList({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final items = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      if (i > 0) items.add(Divider(height: 1, color: context.c.line));
      items.add(children[i]);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: items);
  }
}

/// A tappable row: title, subtitle, and something on the right.
class RowTile extends StatelessWidget {
  const RowTile({super.key, this.leading, required this.title, this.subtitle, this.trailing, this.onTap, this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 12), this.mono = false});
  final Widget? leading;
  final String title;
  final Widget? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: padding,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            if (leading != null) ...[leading!, gap12],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: mono ? mono13(context).copyWith(fontWeight: FontWeight.w600) : context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                  if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 3), child: DefaultTextStyle.merge(style: context.t.bodySmall!, child: subtitle!)),
                ],
              ),
            ),
            if (trailing != null) ...[gap8, trailing!],
            if (onTap != null && trailing == null) Icon(Icons.chevron_right_rounded, size: 20, color: context.c.muted),
          ],
        ),
      ),
    );
  }
}

TextStyle mono13(BuildContext context) => TextStyle(fontFamily: 'GeistMono', fontSize: 13, color: context.c.text, fontWeight: FontWeight.w500);

/// Label / value pairs (the web's DetailList).
class KeyValues extends StatelessWidget {
  const KeyValues(this.rows, {super.key});
  final List<(String, Widget)> rows;
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < rows.length; i++)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: i == 0 ? null : BoxDecoration(border: Border(top: BorderSide(color: context.c.line))),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 120, child: Text(rows[i].$1, style: context.t.bodyMedium!.copyWith(color: context.c.muted))),
                Expanded(child: DefaultTextStyle.merge(style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w500), textAlign: TextAlign.right, child: Align(alignment: Alignment.centerRight, child: rows[i].$2))),
              ],
            ),
          ),
      ],
    );
  }
}

KeyValues kv(List<(String, String)> rows) => KeyValues([for (final r in rows) (r.$1, Text(r.$2, textAlign: TextAlign.right))]);

/// Call / WhatsApp / Email for a customer.
class ContactButtons extends StatelessWidget {
  const ContactButtons({super.key, required this.phone, this.email, required this.onCall, required this.onWhatsApp, this.onEmail});
  final String phone;
  final String? email;
  final VoidCallback onCall;
  final VoidCallback onWhatsApp;
  final VoidCallback? onEmail;
  @override
  Widget build(BuildContext context) {
    Widget b(IconData icon, String label, VoidCallback onTap) => Expanded(
          child: OutlinedButton(
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10), textStyle: const TextStyle(fontFamily: 'Geist', fontSize: 13, fontWeight: FontWeight.w600)),
            onPressed: onTap,
            child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 19), const SizedBox(height: 3), Text(label, maxLines: 1)]),
          ),
        );
    return Row(children: [
      b(Icons.call_outlined, 'Call', onCall),
      gap8,
      b(Icons.chat_outlined, 'WhatsApp', onWhatsApp),
      if (email != null && onEmail != null) ...[gap8, b(Icons.mail_outline_rounded, 'Email', onEmail!)],
    ]);
  }
}

/// 2 × 2 figures on a dark band (packing totals).
class FigureBand extends StatelessWidget {
  const FigureBand(this.items, {super.key, this.dark = true});
  final List<(String, String)> items;
  final bool dark;
  @override
  Widget build(BuildContext context) {
    final fg = dark ? context.c.bg : context.c.text;
    Widget cell((String, String) x) => Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(x.$1.toUpperCase(), style: TextStyle(fontFamily: 'Geist', fontSize: 10, letterSpacing: 1, fontWeight: FontWeight.w600, color: fg.withValues(alpha: 0.65))),
            const SizedBox(height: 3),
            Text(x.$2, style: TextStyle(fontFamily: 'Geist', fontSize: 15, fontWeight: FontWeight.w700, color: fg, fontFeatures: const [FontFeature.tabularFigures()])),
          ]),
        );
    final rows = <Widget>[];
    for (var i = 0; i < items.length; i += 2) {
      if (i > 0) rows.add(const SizedBox(height: 12));
      rows.add(Row(children: [cell(items[i]), if (i + 1 < items.length) cell(items[i + 1]) else const Expanded(child: SizedBox())]));
    }
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: dark ? context.c.text : context.c.surface2, borderRadius: BorderRadius.circular(14)),
      child: Column(children: rows),
    );
  }
}

/* ---------------------------------------------------------------- Badges */

class ToneBadge extends StatelessWidget {
  const ToneBadge(this.label, {super.key, this.tone = Tone.neutral, this.dot = false});
  final String label;
  final Tone tone;
  final bool dot;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = context.c.tone(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6), border: tone == Tone.outline ? Border.all(color: context.c.lineStrong) : null),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[Container(width: 6, height: 6, decoration: BoxDecoration(color: fg, shape: BoxShape.circle)), const SizedBox(width: 5)],
          Text(label, style: TextStyle(fontFamily: 'Geist', fontSize: 12, fontWeight: FontWeight.w500, color: fg, height: 1.3)),
        ],
      ),
    );
  }
}

Widget queryStatusBadge(String s) => ToneBadge(queryStatusLabel[s] ?? s, tone: queryStatusTone[s] ?? Tone.neutral, dot: true);
Widget quotationStatusBadge(String s) => ToneBadge(quotationStatusLabel[s] ?? s, tone: quotationStatusTone[s] ?? Tone.neutral, dot: true);
Widget invoiceStatusBadge(String s) => ToneBadge(invoiceStatusLabel[s] ?? s, tone: invoiceStatusTone[s] ?? Tone.neutral, dot: true);
Widget priorityBadge(String p) => ToneBadge(priorityLabel[p] ?? p, tone: priorityTone[p] ?? Tone.neutral);

class Avatar extends StatelessWidget {
  const Avatar(this.name, {super.key, this.size = 32});
  final String name;
  final double size;
  @override
  Widget build(BuildContext context) {
    final palette = context.c.charts;
    final color = palette[name.codeUnits.fold<int>(0, (a, b) => a + b) % palette.length];
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: color.withValues(alpha: 0.16), shape: BoxShape.circle),
      child: Text(f.initials(name), style: TextStyle(fontFamily: 'Geist', fontSize: size * 0.38, fontWeight: FontWeight.w600, color: color)),
    );
  }
}

/* ---------------------------------------------------------------- States */

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(color: context.c.primarySoft, borderRadius: BorderRadius.circular(14)),
            child: Icon(icon, color: context.c.primary, size: 26),
          ),
          gap12,
          Text(title, textAlign: TextAlign.center, style: context.t.titleSmall),
          if (message != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(message!, textAlign: TextAlign.center, style: context.t.bodySmall)),
          if (action != null) Padding(padding: const EdgeInsets.only(top: 16), child: action!),
        ],
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState(this.error, {super.key, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: EmptyState(
        icon: Icons.cloud_off_rounded,
        title: error is ApiException && (error as ApiException).status == 403 ? 'Not available for your role' : 'Could not load this',
        message: error.toString(),
        action: onRetry == null ? null : OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('Try again')),
      ),
    );
  }
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator(strokeWidth: 2.5)));
}

class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = Tone.info, this.icon});
  final String text;
  final Tone tone;
  final IconData? icon;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = context.c.tone(tone);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10), border: Border.all(color: fg.withValues(alpha: 0.25))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon ?? (tone == Tone.bad ? Icons.error_outline_rounded : tone == Tone.warn ? Icons.warning_amber_rounded : Icons.info_outline_rounded), size: 18, color: fg),
          gap8,
          Expanded(child: Text(text, style: context.t.bodyMedium!.copyWith(color: context.c.text))),
        ],
      ),
    );
  }
}

/* ---------------------------------------------------------------- Stats */

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.hint, this.tone, this.onTap, this.icon});
  final String label;
  final String value;
  final String? hint;
  final Tone? tone;
  final VoidCallback? onTap;
  final IconData? icon;
  @override
  Widget build(BuildContext context) {
    final fg = tone == null ? context.c.text : context.c.tone(tone!).$2;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(child: Text(label, style: context.t.labelMedium, maxLines: 1, overflow: TextOverflow.ellipsis)),
                if (icon != null) Icon(icon, size: 16, color: context.c.muted),
              ]),
              const SizedBox(height: 6),
              FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: TextStyle(fontFamily: 'Geist', fontSize: 22, fontWeight: FontWeight.w600, letterSpacing: -0.5, color: fg))),
              if (hint != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(hint!, style: context.t.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Two tiles per row.
class StatGrid extends StatelessWidget {
  const StatGrid(this.tiles, {super.key});
  final List<Widget> tiles;
  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(child: tiles[i]),
            const SizedBox(width: 10),
            Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
          ]),
        ),
      ));
    }
    return Column(children: rows);
  }
}

/* ---------------------------------------------------------------- Inputs */

class Field extends StatelessWidget {
  const Field({
    super.key,
    required this.label,
    required this.controller,
    this.error,
    this.hint,
    this.helper,
    this.optional = false,
    this.keyboard,
    this.maxLines = 1,
    this.minLines,
    this.obscure = false,
    this.autofill,
    this.onChanged,
    this.mono = false,
    this.prefix,
    this.suffix,
    this.textInputAction,
    this.onSubmitted,
    this.autofocus = false,
    this.formatters,
    this.enabled = true,
  });
  final String label;
  final TextEditingController controller;
  final String? error;
  final String? hint;
  final String? helper;
  final bool optional;
  final TextInputType? keyboard;
  final int maxLines;
  final int? minLines;
  final bool obscure;
  final Iterable<String>? autofill;
  final ValueChanged<String>? onChanged;
  final bool mono;
  final Widget? prefix;
  final Widget? suffix;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final List<TextInputFormatter>? formatters;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      // One accessible element: screen readers announce the label with the box.
      child: MergeSemantics(
        child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FieldLabel(label, optional: optional),
          TextField(
            controller: controller,
            keyboardType: keyboard,
            maxLines: obscure ? 1 : maxLines,
            minLines: minLines,
            obscureText: obscure,
            autofillHints: autofill,
            onChanged: onChanged,
            autofocus: autofocus,
            enabled: enabled,
            inputFormatters: formatters,
            textInputAction: textInputAction,
            onSubmitted: onSubmitted,
            style: mono ? mono13(context).copyWith(fontSize: 15) : context.t.bodyLarge,
            decoration: InputDecoration(hintText: hint, helperText: helper, helperMaxLines: 3, errorText: error, errorMaxLines: 3, prefixIcon: prefix, suffixIcon: suffix),
          ),
        ],
      ),
      ),
    );
  }
}

class FieldLabel extends StatelessWidget {
  const FieldLabel(this.label, {super.key, this.optional = false});
  final String label;
  final bool optional;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text.rich(TextSpan(children: [
        TextSpan(text: label, style: context.t.labelLarge!.copyWith(fontSize: 13.5, color: context.c.text)),
        if (optional) TextSpan(text: '  optional', style: context.t.bodySmall),
      ])),
    );
  }
}

/// A dropdown that looks like the text fields.
class SelectField<T> extends StatelessWidget {
  const SelectField({super.key, required this.label, required this.value, required this.items, required this.onChanged, this.error, this.optional = false, this.hint, this.helper});
  final String label;
  final T? value;
  final List<(T, String)> items;
  final ValueChanged<T?> onChanged;
  final String? error;
  final bool optional;
  final String? hint;
  final String? helper;
  @override
  Widget build(BuildContext context) {
    final has = items.any((i) => i.$1 == value);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FieldLabel(label, optional: optional),
          DropdownButtonFormField<T>(
            initialValue: has ? value : null,
            key: ValueKey('$label:$value'),
            isExpanded: true,
            hint: hint == null ? null : Text(hint!, style: TextStyle(color: context.c.muted)),
            borderRadius: BorderRadius.circular(12),
            dropdownColor: context.c.surface,
            icon: Icon(Icons.expand_more_rounded, color: context.c.muted),
            decoration: InputDecoration(errorText: error, helperText: helper, helperMaxLines: 3),
            items: [for (final i in items) DropdownMenuItem(value: i.$1, child: Text(i.$2, overflow: TextOverflow.ellipsis))],
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}

/// Date picker field (value "YYYY-MM-DD").
class DateField extends StatelessWidget {
  const DateField({super.key, required this.label, required this.value, required this.onChanged, this.error, this.optional = false, this.helper, this.clearable = false});
  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  final String? error;
  final bool optional;
  final String? helper;
  final bool clearable;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FieldLabel(label, optional: optional),
          InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () async {
              final now = DateTime.now();
              final picked = await showDatePicker(
                context: context,
                initialDate: f.parseDate(value) ?? now,
                firstDate: DateTime(now.year - 5),
                lastDate: DateTime(now.year + 5),
              );
              if (picked != null) onChanged(f.isoDate(picked));
            },
            child: InputDecorator(
              decoration: InputDecoration(
                errorText: error,
                helperText: helper,
                suffixIcon: clearable && value.isNotEmpty
                    ? IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => onChanged(''))
                    : Icon(Icons.calendar_today_rounded, size: 18, color: context.c.muted),
              ),
              child: Text(value.isEmpty ? 'Choose a date' : f.date(value), style: value.isEmpty ? TextStyle(color: context.c.muted) : context.t.bodyLarge),
            ),
          ),
        ],
      ),
    );
  }
}

/// Horizontal single-choice chips (list filters, segmented choices).
class ChoiceChips<T> extends StatelessWidget {
  const ChoiceChips({super.key, required this.value, required this.options, required this.onChanged, this.padding = const EdgeInsets.symmetric(horizontal: 16)});
  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: padding,
      child: Row(
        children: [
          for (final o in options)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(o.$2),
                selected: o.$1 == value,
                onSelected: (_) => onChanged(o.$1),
                labelStyle: TextStyle(fontFamily: 'Geist', fontSize: 13, fontWeight: o.$1 == value ? FontWeight.w600 : FontWeight.w500, color: o.$1 == value ? context.c.primary : context.c.text2),
                side: BorderSide(color: o.$1 == value ? context.c.primary.withValues(alpha: 0.35) : context.c.line),
              ),
            ),
        ],
      ),
    );
  }
}

class SearchBox extends StatefulWidget {
  const SearchBox({super.key, required this.hint, required this.onChanged, this.initial = ''});
  final String hint;
  final ValueChanged<String> onChanged;
  final String initial;
  @override
  State<SearchBox> createState() => _SearchBoxState();
}

class _SearchBoxState extends State<SearchBox> {
  late final _ctrl = TextEditingController(text: widget.initial);
  DateTime _last = DateTime.now();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _changed(String v) {
    final stamp = _last = DateTime.now();
    Future.delayed(const Duration(milliseconds: 350), () {
      if (mounted && stamp == _last) widget.onChanged(v.trim());
    });
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
      child: TextField(
        controller: _ctrl,
        onChanged: _changed,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: widget.hint,
          prefixIcon: Icon(Icons.search_rounded, color: context.c.muted, size: 20),
          suffixIcon: _ctrl.text.isEmpty
              ? null
              : IconButton(
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: () {
                    _ctrl.clear();
                    _changed('');
                  }),
        ),
      ),
    );
  }
}

/* ---------------------------------------------------------------- Feedback */

void toast(BuildContext context, String message, {bool error = false}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  messenger?.hideCurrentSnackBar();
  messenger?.showSnackBar(SnackBar(
    content: Row(children: [
      Icon(error ? Icons.error_outline_rounded : Icons.check_circle_outline_rounded, size: 18, color: error ? const Color(0xFFF87171) : const Color(0xFF4ADE80)),
      gap8,
      Expanded(child: Text(message)),
    ]),
  ));
}

Future<bool> confirm(BuildContext context, {required String title, required String message, String action = 'Confirm', bool danger = false}) async {
  final c = context.c;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text('Cancel', style: TextStyle(color: c.text2))),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Runs an action with a spinner on the button; shows the server's message on failure.
class BusyButton extends StatefulWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.icon, this.style = BusyStyle.filled, this.expand = true});
  final String label;
  final Future<void> Function()? onPressed;
  final IconData? icon;
  final BusyStyle style;
  final bool expand;
  @override
  State<BusyButton> createState() => _BusyButtonState();
}

enum BusyStyle { filled, outlined, danger, text }

class _BusyButtonState extends State<BusyButton> {
  bool _busy = false;
  @override
  Widget build(BuildContext context) {
    final onPressed = widget.onPressed == null || _busy
        ? null
        : () async {
            setState(() => _busy = true);
            try {
              await widget.onPressed!();
            } catch (e) {
              if (context.mounted) toast(context, e.toString(), error: true);
            } finally {
              if (mounted) setState(() => _busy = false);
            }
          };
    final child = _busy
        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
        : Row(mainAxisSize: MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
            if (widget.icon != null) ...[Icon(widget.icon, size: 18), const SizedBox(width: 6)],
            Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis)),
          ]);
    final btn = switch (widget.style) {
      BusyStyle.filled => FilledButton(onPressed: onPressed, child: child),
      BusyStyle.danger => FilledButton(style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)), onPressed: onPressed, child: child),
      BusyStyle.outlined => OutlinedButton(onPressed: onPressed, child: _busy ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: context.c.primary)) : child),
      BusyStyle.text => TextButton(onPressed: onPressed, child: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : child),
    };
    return widget.expand ? SizedBox(width: double.infinity, child: btn) : btn;
  }
}

/// A sheet with a title and content, keyboard-safe.
Future<T?> showSheet<T>(BuildContext context, {required String title, String? subtitle, required Widget Function(BuildContext) builder}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(title, style: ctx.t.titleLarge),
            if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(subtitle, style: ctx.t.bodySmall)),
            gap16,
            builder(ctx),
          ],
        ),
      ),
    ),
  );
}

/// The small uppercase heading used above groups.
class Overline extends StatelessWidget {
  const Overline(this.text, {super.key, this.padding = const EdgeInsets.fromLTRB(4, 8, 4, 8)});
  final String text;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Padding(padding: padding, child: Text(text.toUpperCase(), style: context.t.labelSmall));
}

/// Money in tabular figures.
class MoneyText extends StatelessWidget {
  const MoneyText(this.value, this.currency, {super.key, this.style, this.bad = false});
  final Object? value;
  final String currency;
  final TextStyle? style;
  final bool bad;
  @override
  Widget build(BuildContext context) => Text(
        f.money(value, currency),
        style: (style ?? context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)).copyWith(fontFeatures: const [FontFeature.tabularFigures()], color: bad ? context.c.bad : null),
      );
}
