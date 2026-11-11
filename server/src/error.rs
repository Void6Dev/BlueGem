//! Ошибки API в том же виде, что отдавал Python-сервер:
//! `{"detail": {"code": "...", "message": "..."}}` — подпись пользователю
//! подбирает интерфейс по коду на своём языке (см. apiErrorMessage в
//! frontend/src/lib/api.js).
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub body: Value,
}

pub type ApiResult<T> = Result<T, ApiError>;

/// Ошибка с кодом: `message` — английский запасной текст для тех, кто ходит
/// в API напрямую.
pub fn fail(status: u16, code: &str, message: &str) -> ApiError {
    ApiError {
        status: StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_REQUEST),
        body: json!({ "detail": { "code": code, "message": message } }),
    }
}

/// Тело запроса не той формы — как ответ FastAPI на ошибку проверки.
pub fn invalid(message: impl Into<String>) -> ApiError {
    ApiError {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        body: json!({ "detail": [{ "msg": message.into() }] }),
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        crate::emit(&format!("BG_ERROR база: {e}"));
        fail(500, "internal", "Database error")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}
