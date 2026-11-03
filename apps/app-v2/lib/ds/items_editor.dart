import 'package:flutter/material.dart';

import '../core/json.dart';
import 'fields.dart';
import 'format.dart';
import 'theme.dart';
import 'widgets.dart';

int _seq = 0;
String _newKey() => 'k${DateTime.now().microsecondsSinceEpoch}${_seq++}';

/// Gives every item a local key and its parent's key, parts right after their line.
List<Json> keyed(List<Json> items) {
  final out = [for (final i in items) {...i, '_key': i['_key'] ?? i['id'] ?? _newKey()}];
  for (final i in out) {
    final pid = i['parentId'];
    if (pid != null && i['_parent'] == null) i['_parent'] = out.firstWhere((p) => p['id'] == pid, orElse: () => const {})['_key'];
  }
  return ordered(out);
}

/// Lines then their parts, each part right after its line; numbers 1, 1.1, 2…; and what the API
/// needs to know a part's line: parentId for a saved line, partOf (its position) for a new one.
List<Json> ordered(List<Json> items) {
  final tops = items.where((i) => i['_parent'] == null).toList();
  final out = <Json>[];
  for (final (n, t) in tops.indexed) {
    out.add({...t, 'no': '${n + 1}', 'parentId': null, 'partOf': null});
    final parentAt = out.length - 1;
    for (final (m, p) in items.where((i) => i['_parent'] == t['_key']).indexed) {
      out.add({...p, 'no': '${n + 1}.${m + 1}', 'parentId': t['id'], 'partOf': t['id'] == null ? parentAt : null});
    }
  }
  return out;
}

/// The customer's items in a full screen made for long lists: rows load as you scroll, search,
/// ⋯ on a line (Edit, Add a part, Move up / down, Delete), and Add with Save & add another.
/// Returns the new list, or null when nothing changed.
Future<List<Json>?> openItems(BuildContext context, {required List<Json> items, required List<FieldDef> fields, required Json Function() blank, String title = 'Items'}) =>
    Navigator.of(context, rootNavigator: true)
        .push<List<Json>>(MaterialPageRoute(builder: (_) => _ItemsScreen(items: keyed(items), fields: fields, blank: blank, title: title)));

class _ItemsScreen extends StatefulWidget {
  const _ItemsScreen({required this.items, required this.fields, required this.blank, required this.title});
  final List<Json> items;
  final List<FieldDef> fields;
  final Json Function() blank;
  final String title;

  @override
  State<_ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends State<_ItemsScreen> {
  late List<Json> items = widget.items;
  bool changed = false;
  String q = '';

  void _apply(List<Json> next) => setState(() {
        items = ordered(next);
        changed = true;
      });

  /// The sheet for one item; [parent] makes it a part of that line.
  Future<void> _edit({Json? item, String? parent}) async {
    final isNew = item == null;
    var v = {...?item};
    if (isNew) v = {...widget.blank(), '_key': _newKey(), '_parent': parent};
    var version = 0;
    final errors = <String, String>{};
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) {
          bool check() {
            errors.clear();
            for (final f in widget.fields) {
              final e = f.check(v[f.key]);
              if (e != null) errors[f.key] = e;
            }
            set(() {});
            return errors.isEmpty;
          }

          void save({bool another = false}) {
            if (!check()) return;
            final next = [...items];
            final at = next.indexWhere((i) => i['_key'] == v['_key']);
            if (at >= 0) {
              next[at] = v;
            } else {
              next.add(v);
            }
            _apply(next);
            if (another) {
              set(() {
                v = {...widget.blank(), '_key': _newKey(), '_parent': parent};
                version++;
              });
            } else {
              Navigator.pop(ctx);
            }
          }

          final n = items.where((i) => i['_parent'] == null).length;
          return Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Semantics(
                  header: true,
                  child: Text(isNew ? (parent == null ? 'Item ${n + 1}' : 'A part') : 'Item ${item['no'] ?? ''}', style: ctx.text.titleLarge),
                ),
                if (isNew) Text('Save & add another keeps this open', style: ctx.text.bodySmall?.copyWith(color: ctx.colors.text2)),
                const SizedBox(height: Gap.md),
                for (final f in widget.fields) ...[
                  FieldEditor(key: ValueKey('$version.${f.key}'), def: f, value: v[f.key], error: errors[f.key], onChanged: (x) => set(() => v[f.key] = x)),
                  const SizedBox(height: Gap.md),
                ],
                Row(children: [
                  Expanded(child: OutlinedButton(onPressed: save, child: const Text('Save'))),
                  if (isNew) ...[
                    const SizedBox(width: Gap.md),
                    Expanded(flex: 2, child: FilledButton(onPressed: () => save(another: true), child: const Text('Save & add another'))),
                  ],
                ]),
              ]),
            ),
          );
        },
      ),
    );
  }

  void _move(Json item, int by) {
    final siblings = items.where((i) => i['_parent'] == item['_parent']).toList();
    final at = siblings.indexOf(item);
    final to = at + by;
    if (to < 0 || to >= siblings.length) return;
    final other = siblings[to];
    final next = [...items];
    final a = next.indexOf(item), b = next.indexOf(other);
    next[a] = other;
    next[b] = item;
    _apply(next);
  }

  Future<void> _delete(Json item) async {
    final parts = items.where((i) => i['_parent'] == item['_key']).length;
    if (!await confirmDialog(context,
        title: 'Delete item ${item['no']}?', text: parts > 0 ? 'Its $parts parts go too.' : null, yes: 'Delete', danger: true)) {
      return;
    }
    _apply(items.where((i) => i != item && i['_parent'] != item['_key']).toList());
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final words = q.toLowerCase().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    final shown = [
      for (final i in items)
        if (words.every('${i['no']} ${i['description'] ?? ''} ${i['model'] ?? ''}'.toLowerCase().contains)) i,
    ];
    return PopScope(
      canPop: !changed,
      onPopInvokedWithResult: (didPop, _) async {
        if (!didPop && await confirmDialog(context, title: 'Discard the changes to the items?', yes: 'Discard', danger: true) && context.mounted) {
          Navigator.pop(context);
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Semantics(header: true, child: Text('${widget.title} · ${items.where((i) => i['_parent'] == null).length}')),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: Gap.md),
              child: OutlinedButton.icon(onPressed: () => _edit(), icon: const Icon(Icons.add, size: 18), label: const Text('Add')),
            ),
          ],
        ),
        body: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
            child: SearchField(hint: 'Item number, name or model', onChanged: (v) => setState(() => q = v.trim())),
          ),
          Expanded(
            child: items.isEmpty
                ? EmptyState(title: 'No items yet', text: 'Add the customer\'s items one after another.', action: FilledButton(onPressed: () => _edit(), child: const Text('Add an item')))
                : ListView.builder(
                    itemExtent: 64,
                    padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
                    itemCount: shown.length,
                    itemBuilder: (ctx, i) {
                      final it = shown[i];
                      final part = it['_parent'] != null;
                      return Container(
                        padding: EdgeInsets.only(left: part ? 22 : 0),
                        decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.line))),
                        child: Row(children: [
                          Expanded(
                            child: MergeSemantics(
                              child: InkWell(
                                onTap: () => _edit(item: it),
                                child: Row(children: [
                                  SizedBox(width: 34, child: Text('${it['no']}', style: ctx.text.bodySmall?.copyWith(color: c.text2))),
                                  Expanded(
                                    child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text('${it['description'] ?? ''}', style: ctx.text.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                                      Text(joinParts([joinWords(['${it['quantity'] ?? ''}', '${it['unit'] ?? ''}']), it['model'] as String?]),
                                          style: ctx.text.bodySmall?.copyWith(color: c.text2), maxLines: 1),
                                    ]),
                                  ),
                                ]),
                              ),
                            ),
                          ),
                          PopupMenuButton<String>(
                            tooltip: 'More for item ${it['no']}',
                            icon: const Icon(Icons.more_horiz),
                            onSelected: (a) => switch (a) {
                              'edit' => _edit(item: it),
                              'part' => _edit(parent: it['_key'] as String),
                              'up' => _move(it, -1),
                              'down' => _move(it, 1),
                              _ => _delete(it),
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(value: 'edit', child: Text('Edit')),
                              if (!part) const PopupMenuItem(value: 'part', child: Text('Add a part')),
                              const PopupMenuItem(value: 'up', child: Text('Move up')),
                              const PopupMenuItem(value: 'down', child: Text('Move down')),
                              PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: c.bad))),
                            ],
                          ),
                        ]),
                      );
                    },
                  ),
          ),
        ]),
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(Gap.lg),
            child: FilledButton(
              onPressed: () => Navigator.pop(context, changed ? items : null),
              child: Text('Done · ${count(items.where((i) => i['_parent'] == null).length, '1 item', '{} items')}'),
            ),
          ),
        ),
      ),
    );
  }
}
