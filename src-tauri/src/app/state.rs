use crate::{
    contributions::transformer::TransformService,
    extensions::ExtensionService,
    foundation::{AppRoots, SchemaState},
    history::HistoryRepository,
};

pub struct AppState {
    pub roots: AppRoots,
    pub schema_state: SchemaState,
    pub history: HistoryRepository,
    pub transforms: TransformService,
    pub extensions: ExtensionService,
}
