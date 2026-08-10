use crate::{
    contributions::transformer::TransformService,
    foundation::{AppRoots, SchemaState},
    history::HistoryRepository,
};

pub struct AppState {
    pub roots: AppRoots,
    pub schema_state: SchemaState,
    pub history: HistoryRepository,
    pub transforms: TransformService,
}
