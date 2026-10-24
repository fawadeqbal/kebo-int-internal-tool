import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'json.dart';

/// The server's error, with per-field messages from the same validation as the web forms.
class ApiException implements Exception {
  ApiException(this.message, {this.status = 0, this.fieldErrors = const {}, this.code, this.data});
  final String message;
  final int status;
  final Map<String, String> fieldErrors;
  final String? code;
  final Json? data;

  bool get unauthorized => status == 401;
  bool get twoStepSetupRequired => code == 'two_step_setup_required';
  bool get duplicate => status == 409;
  List<Json> get duplicates => data?.l('duplicates') ?? const [];

  String? field(String name) => fieldErrors[name];

  @override
  String toString() => message;
}

/// Talks to /api/v1 on the Kebo RFQ Desk server with the bearer token.
class Api {
  Api({required String baseUrl, this.onSignedOut, this.onSetupRequired}) : _dio = Dio() {
    this.baseUrl = baseUrl;
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
  void Function()? onSignedOut;
  void Function()? onSetupRequired;

  String get baseUrl => _dio.options.baseUrl;
  set baseUrl(String v) => _dio.options.baseUrl = v.replaceAll(RegExp(r'/+$'), '');

  Future<Json> get(String path, {Map<String, dynamic>? query}) => _send(() => _dio.get(path, queryParameters: _clean(query)));
  Future<Json> post(String path, [Object? body]) => _send(() => _dio.post(path, data: body ?? const {}));
  Future<Json> patch(String path, Object body) => _send(() => _dio.patch(path, data: body));
  Future<Json> put(String path, Object body) => _send(() => _dio.put(path, data: body));
  Future<Json> delete(String path) => _send(() => _dio.delete(path));

  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) {
    if (q == null) return null;
    return {
      for (final e in q.entries)
        if (e.value != null && e.value.toString().isNotEmpty) e.key: e.value
    };
  }

  /// Upload files to an inquiry (same endpoint as the web uploader).
  Future<void> uploadFiles(String inquiryId, List<({String name, String path})> files, {void Function(double)? onProgress}) async {
    final form = FormData();
    for (final f in files) {
      form.files.add(MapEntry('files', await MultipartFile.fromFile(f.path, filename: f.name)));
    }
    await _send(() => _dio.post('/api/queries/$inquiryId/attachments',
        data: form, onSendProgress: (a, b) => onProgress?.call(b > 0 ? a / b : 0)));
  }

  /// A file or PDF as bytes (for the in-app viewers, saving and sharing).
  Future<Uint8List> getBytes(String path, {void Function(double)? onProgress}) async {
    try {
      final res = await _dio.get<List<int>>(
        path,
        options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 3)),
        onReceiveProgress: (a, b) => onProgress?.call(b > 0 ? a / b : 0),
      );
      return Uint8List.fromList(res.data ?? const []);
    } on DioException catch (e) {
      throw _error(e);
    }
  }

  /// Download a PDF or file to the app's documents folder; returns its path.
  Future<String> download(String path, String fileName) async {
    final dir = await getApplicationDocumentsDirectory();
    final safe = fileName.replaceAll(RegExp(r'[^\w.\- ]+'), '_');
    final target = '${dir.path}/$safe';
    try {
      await _dio.download(path, target, options: Options(receiveTimeout: const Duration(minutes: 2)));
    } on DioException catch (e) {
      throw _error(e);
    }
    return target;
  }

  Future<Json> _send(Future<Response<dynamic>> Function() request) async {
    try {
      final res = await request();
      final data = res.data;
      if (data is Map) return data.cast<String, dynamic>();
      return <String, dynamic>{};
    } on DioException catch (e) {
      throw _error(e);
    }
  }

  ApiException _error(DioException e) {
    final res = e.response;
    if (res == null) {
      debugPrint('[api] ${e.type} ${e.message}');
      return ApiException(
        e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout
            ? 'The server is taking too long to answer. Check your connection and try again.'
            : 'Can\'t reach the server. Check your internet connection.',
      );
    }
    final body = res.data is Map ? (res.data as Map).cast<String, dynamic>() : <String, dynamic>{};
    final fields = <String, String>{};
    final fe = body['fieldErrors'];
    if (fe is Map) {
      fe.forEach((k, v) {
        if (v is List && v.isNotEmpty) fields[k.toString()] = v.first.toString();
      });
    }
    final err = ApiException(
      body.s('error', res.statusCode == 404 ? 'Not found.' : 'Something went wrong (${res.statusCode}).'),
      status: res.statusCode ?? 0,
      fieldErrors: fields,
      code: body.sn('code'),
      data: body,
    );
    if (err.unauthorized && token != null && !(res.requestOptions.path.contains('/auth/'))) onSignedOut?.call();
    if (err.twoStepSetupRequired) onSetupRequired?.call();
    return err;
  }
}
