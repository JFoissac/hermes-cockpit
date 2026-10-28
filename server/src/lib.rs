//! Hermes Cockpit server library.
//!
//! Exposed as a library so the integration tests can drive the same router and
//! the same read-only SQLite helpers as the binary.

pub mod hermes_api;
pub mod hermes_db;
pub mod model;
pub mod routes;
pub mod state;
