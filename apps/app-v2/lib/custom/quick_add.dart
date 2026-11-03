import 'package:flutter/material.dart';

import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/screens/customer_form.g.dart';
import 'order_files.dart';

/// One way to start something from the + button.
class _Action {
  const _Action(this.icon, this.title, this.sub, this.run, {this.perm});
  final IconData icon;
  final String title, sub;
  final String? perm;
  final Future<void> Function(BuildContext context) run;
}

final _actions = <_Action>[
  _Action(Icons.photo_camera_outlined, 'Snap & attach', 'a photo or file to an order', _snap),
  _Action(Icons.person_add_alt, 'New customer', 'with their contacts', (c) async {
    if (await CustomerFormSheet.create(c) && c.mounted) toast(c, 'Customer saved');
  }, perm: 'customers.manage'),
];

/// The + in the middle of the bottom bar: the things done most on the go.
Future<void> showQuickAdd(BuildContext context) async {
  final actions = _actions.where((a) => context.can(a.perm)).toList();
  final picked = await showModalBottomSheet<_Action>(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Semantics(header: true, child: Text('Quick add', style: ctx.text.titleLarge)),
          Text('What do you want to do?', style: ctx.text.bodySmall?.copyWith(color: ctx.colors.text2)),
          const SizedBox(height: Gap.md),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            mainAxisSpacing: Gap.md,
            crossAxisSpacing: Gap.md,
            childAspectRatio: 1.45,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              for (final a in actions)
                Semantics(
                  button: true,
                  label: '${a.title}, ${a.sub}',
                  excludeSemantics: true,
                  onTap: () => Navigator.pop(ctx, a),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(Gap.radius),
                    onTap: () => Navigator.pop(ctx, a),
                    child: Container(
                      padding: const EdgeInsets.all(Gap.md),
                      decoration: BoxDecoration(
                        color: ctx.colors.surface,
                        borderRadius: BorderRadius.circular(Gap.radius),
                        border: Border.all(color: ctx.colors.line),
                      ),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                        Icon(a.icon, color: ctx.colors.primary),
                        const SizedBox(height: Gap.sm),
                        Text(a.title, style: ctx.text.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                        Text(a.sub, style: ctx.text.bodySmall?.copyWith(color: ctx.colors.text2), maxLines: 2),
                      ]),
                    ),
                  ),
                ),
            ],
          ),
        ]),
      ),
    ),
  );
  if (picked != null && context.mounted) await picked.run(context);
}

/// Which order the photo is for, then the photo.
Future<void> _snap(BuildContext context) async {
  final order = await pickOrder(context);
  if (order == null || !context.mounted) return;
  if (await uploadToOrder(context, order.str('id'), order.str('refNo')) && context.mounted) toast(context, 'Added to ${order.str('refNo')}');
}

/// A searchable list of open orders in a sheet.
Future<Json?> pickOrder(BuildContext context) => showModalBottomSheet<Json>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => SizedBox(
        height: MediaQuery.sizeOf(ctx).height * 0.85,
        child: ListFrame<Json>(
          title: 'Which order?',
          searchHint: 'Order, customer or product',
          localSearch: true,
          load: (api, q, page, query) async => Paged.all(await api.getList('/api/orders')),
          row: (o) => RowData(
            title: o.str('refNo'),
            sub: [o.at('customer.name'), o.at('inquiry.title')],
          ),
          onOpen: (c, o) => Navigator.pop(ctx, o),
        ),
      ),
    );
