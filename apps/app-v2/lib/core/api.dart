import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'files.dart';

import 'json.dart';

/// The server's error: always `{ message | error, code?, fieldErrors?, ... }`.
class ApiException implements Exception {
  ApiException(this.message, {this.status = 0, this.code, this.fieldErrors = const {}, this.data = const {}});

  final String message;
  final int status;
  final String? code;
  final Map<String, String> fieldErrors;
  final Json data;

  bool get unauthorized => status == 401;
  bool get offline => status == 0;

  /// 409 "duplicate": `matches: [{ id, label, detail }]`.
  List<Json> get matches => data.list('matches', (m) => m);

  @override
  String toString() => message;
}

/// Talks to `<server>/api/...` with the bearer token.
class Api {
  Api({required String server, Dio? dio}) : _dio = dio ?? Dio() {
    this.server = server;
    _dio.options
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 60)
      ..headers['Accept'] = 'application/json';
    _dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      if (token != null) o.headers['Authorization'] = 'Bearer $token';
      h.next(o);
    }));
  }

  final Dio _dio;
  String? token;

  /// Called on any 401, so the app can go back to sign-in.
  void Function()? onSignedOut;

  String get server => _dio.options.baseUrl;

  /// A trailing "/" or "/api" typed by someone is dropped: every path starts with /api/.
  set server(String v) => _dio.options.baseUrl = v.trim().replaceAll(RegExp(r'/+$'), '').replaceAll(RegExp(r'/api$'), '');

  Future<Json> get(String path, {Map<String, Object?>? query}) => _map(() => _dio.get<Object?>(path, queryParameters: _clean(query)));

  Future<List<Json>> getList(String path, {Map<String, Object?>? query}) async {
    final data = await _send(() => _dio.get<Object?>(path, queryParameters: _clean(query)));
    return data is List ? [for (final e in data) if (e is Map<String, dynamic>) e] : const [];
  }

  Future<Json> post(String path, [Object? body]) => _map(() => _dio.post<Object?>(path, data: body ?? const <String, Object?>{}));
  Future<Json> put(String path, Object body) => _map(() => _dio.put<Object?>(path, data: body));
  Future<Json> patch(String path, Object body) => _map(() => _dio.patch<Object?>(path, data: body));
  Future<void> delete(String path) => _send(() => _dio.delete<Object?>(path));

  /// A file with its name from Content-Disposition; [progress] goes 0 → 1 when the size is known.
  Future<Downloaded> download(String path, {void Function(double)? progress}) async {
    try {
      final res = await _dio.get<List<int>>(
        path,
        options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 3)),
        onReceiveProgress: progress == null ? null : (got, total) => total > 0 ? progress(got / total) : null,
      );
      return Downloaded(
        Uint8List.fromList(res.data ?? const []),
        fileName: fileNameFrom(res.headers.value('content-disposition')),
        type: res.headers.value('content-type')?.split(';').first.trim(),
      );
    } on DioException catch (e) {
      // The error body came as bytes: read it as the usual JSON.
      final data = e.response?.data;
      if (data is List<int>) {
        Object? body;
        try {
          body = jsonDecode(utf8.decode(data));
        } catch (_) {
          body = {'error': utf8.decode(data, allowMalformed: true).trim()};
        }
        throw _error(DioException(requestOptions: e.requestOptions, response: Response(requestOptions: e.requestOptions, statusCode: e.response?.statusCode, data: body)));
      }
      throw _error(e);
    }
  }

  /// multipart/form-data: one `file` and the text [fields]. [progress] goes 0 → 1.
  Future<Json> upload(String path, {required Uint8List bytes, required String fileName, Map<String, String?> fields = const {}, void Function(double)? progress}) =>
      _map(() => _dio.post<Object?>(
            path,
            data: FormData.fromMap({
              for (final e in fields.entries) if (e.value != null && e.value!.isNotEmpty) e.key: e.value,
              'file': MultipartFile.fromBytes(bytes, filename: fileName),
            }),
            options: Options(sendTimeout: const Duration(minutes: 5), receiveTimeout: const Duration(minutes: 2)),
            onSendProgress: progress == null ? null : (sent, total) => total > 0 ? progress(sent / total) : null,
          ));

  static Map<String, Object?>? _clean(Map<String, Object?>? q) =>
      q == null ? null : {for (final e in q.entries) if (e.value != null && e.value != '') e.key: e.value};

  Future<Json> _map(Future<Response<Object?>> Function() call) async {
    final data = await _send(call);
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  Future<Object?> _send(Future<Response<Object?>> Function() call) async {
    try {
      return (await call()).data;
    } on DioException catch (e) {
      throw _error(e);
    }
  }

  ApiException _error(DioException e) {
    final res = e.response;
    if (res == null) {
      return ApiException('No connection to the server. Check the internet and try again.');
    }
    final body = res.data is Map<String, dynamic> ? res.data as Json : <String, dynamic>{};
    final status = res.statusCode ?? 0;
    if (status == 401 && token != null) onSignedOut?.call();
    final fields = <String, String>{};
    final fe = body['fieldErrors'];
    if (fe is Map) {
      for (final MapEntry(:key, :value) in fe.entries) {
        final msg = value is List && value.isNotEmpty ? '${value.first}' : '$value';
        fields['$key'] = msg;
      }
    }
    final message = body.strOrNull('message') ?? body.strOrNull('error') ?? switch (status) {
      403 => 'You do not have permission to do this.',
      404 => 'This was not found. It may have been deleted.',
      _ => 'Something went wrong on the server ($status). Try again.',
    };
    return ApiException(message, status: status, code: body.strOrNull('code'), fieldErrors: fields, data: body);
  }
}
