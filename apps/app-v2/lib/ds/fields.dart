import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../generated/countries.g.dart';
import 'theme.dart';

enum FieldKind { text, multiline, email, phone, country, integer, decimal, toggle, date, choice }

/// One field of a form, as the spec describes it. Generated as `<Entity>Fields.<name>`.
class FieldDef {
  const FieldDef(this.key, this.label, this.kind,
      {this.required = false, this.max, this.hint, this.upper = false, this.options = const {}, this.defaultValue});

  final String key, label;
  final FieldKind kind;
  final bool required;
  final int? max;
  final String? hint;
  final bool upper;

  /// value → label, for choices.
  final Map<String, String> options;
  final String? defaultValue;

  static final _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  /// The problem with [v], or null when it is fine.
  String? check(Object? v) {
    final s = v is String ? v.trim() : v;
    final empty = s == null || s == '' || (kind == FieldKind.toggle && s == false);
    if (empty) return required && kind != FieldKind.toggle ? '$label is needed' : null;
    if (s is String) {
      if (max != null && s.length > max!) return '$label: at most $max characters';
      if (kind == FieldKind.email && !_email.hasMatch(s)) return 'Enter an email like name@company.com';
      if (kind == FieldKind.phone && s.replaceAll(RegExp(r'\D'), '').length < 7) return 'Enter the full number with the country code';
      if (kind == FieldKind.integer && int.tryParse(s) == null) return 'Enter a whole number';
      if (kind == FieldKind.decimal && num.tryParse(s) == null) return 'Enter a number';
    }
    return null;
  }
}

/// At least one of [keys] must have a value; the message shows under the first.
class AnyOf {
  const AnyOf(this.keys, this.message);
  final List<String> keys;
  final String message;

  bool ok(Map<String, Object?> values) => keys.any((k) {
        final v = values[k];
        return v != null && (v is! String || v.trim().isNotEmpty);
      });
}

/// The editor for one field. Labels sit above the box, like on the web.
class FieldEditor extends StatefulWidget {
  const FieldEditor({super.key, required this.def, required this.value, required this.onChanged, this.error});
  final FieldDef def;
  final Object? value;
  final ValueChanged<Object?> onChanged;
  final String? error;

  @override
  State<FieldEditor> createState() => _FieldEditorState();
}

class _FieldEditorState extends State<FieldEditor> {
  late final _ctl = TextEditingController(text: _text(widget.value));

  static String _text(Object? v) => v == null ? '' : '$v';

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.def;
    final c = context.colors;
    final label = Row(children: [
      Flexible(child: Text(d.label, style: context.text.labelMedium)),
      if (!d.required && d.defaultValue == null && d.kind != FieldKind.toggle && d.kind != FieldKind.choice)
        Text('  optional', style: context.text.labelSmall?.copyWith(color: c.muted, fontWeight: FontWeight.w400)),
    ]);
    if (d.kind == FieldKind.toggle) {
      return MergeSemantics(
        child: SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(d.label, style: context.text.bodyMedium),
          value: widget.value == true,
          onChanged: widget.onChanged,
        ),
      );
    }
    final Widget input = switch (d.kind) {
      FieldKind.choice => _choice(context),
      FieldKind.country => _country(context),
      _ => TextField(
          controller: _ctl,
          onChanged: (v) => widget.onChanged(d.upper ? v.toUpperCase() : v),
          keyboardType: switch (d.kind) {
            FieldKind.email => TextInputType.emailAddress,
            FieldKind.phone => TextInputType.phone,
            FieldKind.integer => TextInputType.number,
            FieldKind.decimal => const TextInputType.numberWithOptions(decimal: true),
            FieldKind.multiline => TextInputType.multiline,
            _ => TextInputType.text,
          },
          textCapitalization: d.upper
              ? TextCapitalization.characters
              : d.kind == FieldKind.text || d.kind == FieldKind.multiline
                  ? TextCapitalization.sentences
                  : TextCapitalization.none,
          autocorrect: d.kind == FieldKind.multiline,
          minLines: d.kind == FieldKind.multiline ? 3 : 1,
          maxLines: d.kind == FieldKind.multiline ? 8 : 1,
          inputFormatters: [if (d.max != null) LengthLimitingTextInputFormatter(d.max)],
          decoration: InputDecoration(
            errorText: widget.error,
            helperText: d.hint,
            semanticCounterText: '',
          ),
        ),
    };
    return Semantics(
      label: d.label,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        ExcludeSemantics(child: label),
        const SizedBox(height: 6),
        input,
        if (widget.error != null && (d.kind == FieldKind.choice || d.kind == FieldKind.country)) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.md, 6, Gap.md, 0),
            child: Text(widget.error!, style: context.text.bodySmall?.copyWith(color: c.bad)),
          ),
        ],
      ]),
    );
  }

  /// Up to four options: chips, all visible. More: a menu.
  Widget _choice(BuildContext context) {
    final d = widget.def;
    if (d.options.length <= 4) {
      return Wrap(spacing: Gap.sm, runSpacing: Gap.sm, children: [
        for (final e in d.options.entries)
          ChoiceChip(
            label: Text(e.value),
            selected: widget.value == e.key,
            onSelected: (_) => widget.onChanged(e.key),
          ),
      ]);
    }
    return DropdownButtonFormField<String>(
      initialValue: d.options.containsKey(widget.value) ? widget.value as String : null,
      items: [for (final e in d.options.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
      onChanged: widget.onChanged,
      decoration: InputDecoration(errorText: widget.error),
    );
  }

  Widget _country(BuildContext context) {
    final c = context.colors;
    final code = widget.value as String?;
    final name = countryName(code);
    return InkWell(
      borderRadius: BorderRadius.circular(Gap.radiusSm),
      onTap: () async {
        final picked = await pickCountry(context);
        if (picked != null) widget.onChanged(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(
          suffixIcon: const Icon(Icons.expand_more),
          enabledBorder: widget.error == null ? null : OutlineInputBorder(borderSide: BorderSide(color: c.bad)),
        ),
        child: Text(name ?? 'Choose a country', style: context.text.bodyLarge?.copyWith(color: name == null ? c.muted : c.text)),
      ),
    );
  }
}

/// A searchable list of countries in a sheet. The ISO code, or null when closed.
Future<String?> pickCountry(BuildContext context) => showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => const _CountrySheet(),
    );

class _CountrySheet extends StatefulWidget {
  const _CountrySheet();

  @override
  State<_CountrySheet> createState() => _CountrySheetState();
}

class _CountrySheetState extends State<_CountrySheet> {
  String q = '';

  @override
  Widget build(BuildContext context) {
    final rows = countries.entries
        .where((e) => q.isEmpty || e.value.toLowerCase().contains(q) || e.key.toLowerCase() == q)
        .toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.85,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
          child: TextField(
            autofocus: true,
            onChanged: (v) => setState(() => q = v.trim().toLowerCase()),
            decoration: const InputDecoration(hintText: 'Search countries', prefixIcon: Icon(Icons.search)),
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: rows.length,
            itemBuilder: (ctx, i) => ListTile(
              minTileHeight: Gap.tap,
              title: Text(rows[i].value),
              trailing: Text(rows[i].key, style: ctx.text.bodySmall?.copyWith(color: ctx.colors.muted)),
              onTap: () => Navigator.pop(ctx, rows[i].key),
            ),
          ),
        ),
      ]),
    );
  }
}
