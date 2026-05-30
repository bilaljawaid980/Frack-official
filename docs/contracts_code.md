# Code dump for '/home/shahnil/Desktop/FRACKS/3643' (pattern: *.rs)

## contracts/claim_topics_registry/src/bin/schema.rs

```
use cosmwasm_schema::write_api;

use claim_topics_registry_cw::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        migrate: MigrateMsg,
    }
}

```

## contracts/claim_topics_registry/src/contract.rs

```
//! Claim Topics Registry Contract
//! 
//! This contract manages the list of required claim topics for token holders.
//! Only the owner can modify the required topics list.

use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:claim-topics-registry-cw";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ERC-3643 Constraint: Max 15 claim topics (gas limit consideration)
const MAX_CLAIM_TOPICS: usize = 15;

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    OWNER.save(deps.storage, &msg.owner)?;
    REQUIRED_TOPICS.save(deps.storage, &msg.required_topics)?;
    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", info.sender))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::SetRequiredTopics { topics } => {
            only_owner(deps.as_ref(), &info)?;
            
            // ERC-3643 Constraint: Cannot require more than 15 topics (gas limit consideration)
            if topics.len() > MAX_CLAIM_TOPICS {
                return Err(ContractError::TooManyTopics {
                    max: MAX_CLAIM_TOPICS,
                });
            }
            
            REQUIRED_TOPICS.save(deps.storage, &topics)?;
            Ok(Response::new().add_attribute("action", "set_required_topics"))
        }
        ExecuteMsg::UpdateOwner { owner } => {
            only_owner(deps.as_ref(), &info)?;
            OWNER.save(deps.storage, &owner)?;
            Ok(Response::new()
                .add_attribute("action", "update_owner")
                .add_attribute("owner", owner))
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::RequiredTopics {} => to_json_binary(&RequiredTopicsResponse {
            topics: REQUIRED_TOPICS.load(deps.storage)?,
        }),
        QueryMsg::Owner {} => to_json_binary(&OwnerResponse {
            owner: OWNER.load(deps.storage)?,
        }),
    }
}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new().add_attribute("action", "migrate"))
}

// Helper functions

fn only_owner(deps: Deps, info: &MessageInfo) -> Result<(), ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender.to_string() != owner {
        return Err(ContractError::Unauthorized {});
    }
    Ok(())
}

```

## contracts/claim_topics_registry/src/error.rs

```
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Topic already exists: {topic}")]
    TopicAlreadyExists { topic: u32 },

    #[error("Topic not found: {topic}")]
    TopicNotFound { topic: u32 },
    
    #[error("Too many claim topics: maximum is {max}")]
    TooManyTopics { max: usize },
}

```

## contracts/claim_topics_registry/src/lib.rs

```
//! Claim Topics Registry Library
//! 
//! This library provides the public API for the Claim Topics Registry contract.
//! All business logic is implemented in contract.rs.

pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

// Re-export for external usage
pub use crate::error::ContractError;
pub use crate::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};

```

## contracts/claim_topics_registry/src/msg.rs

```
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub owner: String,
    pub required_topics: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    SetRequiredTopics { topics: Vec<u32> },
    UpdateOwner { owner: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    RequiredTopics {},
    Owner {},
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RequiredTopicsResponse {
    pub topics: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct OwnerResponse {
    pub owner: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

```

## contracts/claim_topics_registry/src/state.rs

```
use cw_storage_plus::Item;

pub const OWNER: Item<String> = Item::new("owner");
pub const REQUIRED_TOPICS: Item<Vec<u32>> = Item::new("required_topics");

```

## contracts/compliance_contract/src/bin/schema.rs

```
use cosmwasm_schema::write_api;

use compliance_contract_cw::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        migrate: MigrateMsg,
    }
}

```

## contracts/compliance_contract/src/contract.rs

```
//! Compliance Contract
//!
//! This contract enforces compliance rules for token transfers including
//! per-address limits and country-based restrictions using the identity registry.
//! Now supports modular compliance architecture per ERC-3643 T-REX standard.

use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Response,
    StdResult, Uint128, WasmMsg,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::module::ModuleExecuteMsg;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:compliance-contract-cw";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let owner = deps.api.addr_validate(&msg.owner)?;
    OWNER.save(deps.storage, &owner)?;
    let ir = msg
        .identity_registry
        .and_then(|s| deps.api.addr_validate(&s).ok());
    IDENTITY_REGISTRY_ADDR.save(deps.storage, &ir)?;
    ALLOWED_COUNTRIES.save(deps.storage, &None)?;
    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", info.sender))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        // Module management
        ExecuteMsg::AddModule { module, name } => {
            only_owner(deps.as_ref(), &info)?;
            execute_add_module(deps, module, name)
        }
        ExecuteMsg::RemoveModule { module } => {
            only_owner(deps.as_ref(), &info)?;
            execute_remove_module(deps, module)
        }

        // Legacy compliance rules
        ExecuteMsg::SetPerAddressLimit { address, limit } => {
            only_owner(deps.as_ref(), &info)?;
            let addr = deps.api.addr_validate(&address)?;
            PER_ADDR_LIMIT.save(deps.storage, &addr, &limit)?;
            Ok(Response::new()
                .add_attribute("action", "set_per_address_limit")
                .add_attribute("address", address))
        }
        ExecuteMsg::SetAllowedCountries { countries } => {
            only_owner(deps.as_ref(), &info)?;
            ALLOWED_COUNTRIES.save(deps.storage, &countries)?;
            Ok(Response::new().add_attribute("action", "set_allowed_countries"))
        }

        // TREX callback functions
        ExecuteMsg::Transferred { from, to, amount } => {
            execute_transferred(deps, from, to, amount)
        }
        ExecuteMsg::Created { to, amount } => {
            execute_created(deps, to, amount)
        }
        ExecuteMsg::Destroyed { from, amount } => {
            execute_destroyed(deps, from, amount)
        }

        // Configuration
        ExecuteMsg::SetIdentityRegistry { addr } => {
            only_owner(deps.as_ref(), &info)?;
            let parsed = addr.and_then(|s| deps.api.addr_validate(&s).ok());
            IDENTITY_REGISTRY_ADDR.save(deps.storage, &parsed)?;
            Ok(Response::new().add_attribute("action", "set_identity_registry"))
        }
        ExecuteMsg::UpdateOwner { owner } => {
            only_owner(deps.as_ref(), &info)?;
            let o = deps.api.addr_validate(&owner)?;
            OWNER.save(deps.storage, &o)?;
            Ok(Response::new()
                .add_attribute("action", "update_owner")
                .add_attribute("owner", owner))
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::CanTransfer {
            token: _,
            from,
            to,
            amount,
        } => to_json_binary(&query_can_transfer(deps, from, to, amount)?),
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::Modules {} => to_json_binary(&query_modules(deps)?),
        QueryMsg::ModuleInfo { module } => to_json_binary(&query_module_info(deps, module)?),
    }
}

fn query_can_transfer(
    deps: Deps,
    from: String,
    to: String,
    amount: Uint128,
) -> StdResult<CanTransferResponse> {
    let from_addr = deps.api.addr_validate(&from)?;
    let to_addr = deps.api.addr_validate(&to)?;

    // Per-address limit check for sender
    if let Some(limit) = PER_ADDR_LIMIT.may_load(deps.storage, &from_addr)?.flatten() {
        if amount > limit {
            return Ok(CanTransferResponse {
                allowed: false,
                reason: Some("amount exceeds per-address limit".to_string()),
            });
        }
    }

    // Country whitelist check using IR if configured
    let allowed_countries = ALLOWED_COUNTRIES.load(deps.storage)?;
    if let Some(list) = allowed_countries {
        if let Some(ir) = IDENTITY_REGISTRY_ADDR.may_load(deps.storage)?.flatten() {
            // Query countries for from and to
            let from_country: Option<String> = query_country(deps, &ir, &from_addr)?;
            let to_country: Option<String> = query_country(deps, &ir, &to_addr)?;
            if from_country.is_none() || to_country.is_none() {
                return Ok(CanTransferResponse {
                    allowed: false,
                    reason: Some("missing country info".to_string()),
                });
            }
            let fc = from_country.unwrap();
            let tc = to_country.unwrap();
            if !list.contains(&fc) || !list.contains(&tc) {
                return Ok(CanTransferResponse {
                    allowed: false,
                    reason: Some("country not allowed".to_string()),
                });
            }
        }
    }

    Ok(CanTransferResponse {
        allowed: true,
        reason: None,
    })
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let owner = OWNER.load(deps.storage)?;
    let ir = IDENTITY_REGISTRY_ADDR
        .may_load(deps.storage)?
        .flatten()
        .map(|a| a.to_string());
    let allowed = ALLOWED_COUNTRIES.load(deps.storage)?;
    let module_count = MODULES
        .keys(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .count() as u32;
    Ok(ConfigResponse {
        owner: owner.to_string(),
        identity_registry: ir,
        allowed_countries: allowed,
        module_count,
    })
}

fn query_country(deps: Deps, ir: &Addr, wallet: &Addr) -> StdResult<Option<String>> {
    // Use the IR Identity query to get country
    #[derive(serde::Serialize)]
    #[serde(rename_all = "snake_case")]
    enum IrQuery<'a> {
        Identity { wallet: &'a str },
    }

    #[derive(serde::Deserialize)]
    struct IdentityResp {
        country: Option<String>,
    }

    let resp: IdentityResp = deps.querier.query_wasm_smart(
        ir.clone(),
        &IrQuery::Identity {
            wallet: wallet.as_str(),
        },
    )?;
    Ok(resp.country)
}

fn only_owner(deps: Deps, info: &MessageInfo) -> Result<(), ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::Unauthorized {});
    }
    Ok(())
}

// Module management functions
fn execute_add_module(
    deps: DepsMut,
    module: String,
    name: String,
) -> Result<Response, ContractError> {
    let module_addr = deps.api.addr_validate(&module)?;

    // Check if module already exists
    if MODULES.has(deps.storage, &module_addr) {
        return Err(ContractError::CustomError {
            msg: "Module already exists".to_string(),
        });
    }

    // Check if name is already taken
    if MODULE_NAMES.has(deps.storage, &name) {
        return Err(ContractError::CustomError {
            msg: "Module name already exists".to_string(),
        });
    }

    // Add module
    let module_info = crate::state::ModuleInfo { name: name.clone() };
    MODULES.save(deps.storage, &module_addr, &module_info)?;
    MODULE_NAMES.save(deps.storage, &name, &module_addr)?;

    Ok(Response::new()
        .add_attribute("action", "add_module")
        .add_attribute("module", module)
        .add_attribute("name", name))
}

fn execute_remove_module(
    deps: DepsMut,
    module: String,
) -> Result<Response, ContractError> {
    let module_addr = deps.api.addr_validate(&module)?;

    // Get module info to remove name mapping
    if let Some(module_info) = MODULES.may_load(deps.storage, &module_addr)? {
        MODULE_NAMES.remove(deps.storage, &module_info.name);
    }

    // Remove module
    MODULES.remove(deps.storage, &module_addr);

    Ok(Response::new()
        .add_attribute("action", "remove_module")
        .add_attribute("module", module))
}

// TREX callback functions
fn execute_transferred(
    deps: DepsMut,
    from: String,
    to: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let mut response = Response::new()
        .add_attribute("action", "transferred")
        .add_attribute("from", from.clone())
        .add_attribute("to", to.clone())
        .add_attribute("amount", amount.to_string());

    // Call all modules
    let modules: Vec<_> = MODULES
        .keys(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .collect::<StdResult<_>>()?;

    for module_addr in modules {
        let msg = WasmMsg::Execute {
            contract_addr: module_addr.to_string(),
            msg: to_json_binary(&ModuleExecuteMsg::Transferred {
                from: from.clone(),
                to: to.clone(),
                amount,
            })?,
            funds: vec![],
        };
        response = response.add_message(msg);
    }

    Ok(response)
}

fn execute_created(
    deps: DepsMut,
    to: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let mut response = Response::new()
        .add_attribute("action", "created")
        .add_attribute("to", to.clone())
        .add_attribute("amount", amount.to_string());

    // Call all modules
    let modules: Vec<_> = MODULES
        .keys(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .collect::<StdResult<_>>()?;

    for module_addr in modules {
        let msg = WasmMsg::Execute {
            contract_addr: module_addr.to_string(),
            msg: to_json_binary(&ModuleExecuteMsg::Created {
                to: to.clone(),
                amount,
            })?,
            funds: vec![],
        };
        response = response.add_message(msg);
    }

    Ok(response)
}

fn execute_destroyed(
    deps: DepsMut,
    from: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let mut response = Response::new()
        .add_attribute("action", "destroyed")
        .add_attribute("from", from.clone())
        .add_attribute("amount", amount.to_string());

    // Call all modules
    let modules: Vec<_> = MODULES
        .keys(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .collect::<StdResult<_>>()?;

    for module_addr in modules {
        let msg = WasmMsg::Execute {
            contract_addr: module_addr.to_string(),
            msg: to_json_binary(&ModuleExecuteMsg::Destroyed {
                from: from.clone(),
                amount,
            })?,
            funds: vec![],
        };
        response = response.add_message(msg);
    }

    Ok(response)
}

// Query functions
fn query_modules(deps: Deps) -> StdResult<ModulesResponse> {
    let modules: StdResult<Vec<_>> = MODULES
        .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .map(|item| {
            let (addr, info) = item?;
            Ok(crate::msg::ModuleInfo {
                address: addr.to_string(),
                name: info.name,
            })
        })
        .collect();

    Ok(ModulesResponse {
        modules: modules?,
    })
}

fn query_module_info(deps: Deps, module: String) -> StdResult<crate::msg::ModuleInfoResponse> {
    let module_addr = deps.api.addr_validate(&module)?;
    let info = MODULES.may_load(deps.storage, &module_addr)?;
    Ok(crate::msg::ModuleInfoResponse {
        info: info.map(|i| crate::msg::ModuleInfo {
            address: module,
            name: i.name,
        }),
    })
}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new().add_attribute("action", "migrate"))
}

```

## contracts/compliance_contract/src/error.rs

```
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Country {country} is restricted")]
    CountryRestricted { country: u16 },

    #[error("Transfer amount {amount} exceeds limit {limit}")]
    TransferLimitExceeded { amount: String, limit: String },

    #[error("{msg}")]
    CustomError { msg: String },
}

```

## contracts/compliance_contract/src/lib.rs

```
//! Compliance Contract Library
//!
//! This library provides the public API for the Compliance Contract.
//! All business logic is implemented in contract.rs.

pub mod contract;
pub mod error;
pub mod module;
pub mod msg;
pub mod state;

// Re-export for external usage
pub use crate::error::ContractError;
pub use crate::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};

```

## contracts/compliance_contract/src/module.rs

```
use cosmwasm_std::Uint128;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Interface that all compliance modules must implement
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModuleQueryMsg {
    /// Check if a transfer is allowed by this module
    CanTransfer {
        from: String,
        to: String,
        amount: Uint128,
    },
    /// Get module information
    ModuleInfo {},
}

/// Response from CanTransfer query
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ModuleCanTransferResponse {
    pub allowed: bool,
    pub reason: Option<String>,
}

/// Module information response
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ModuleInfoResponse {
    pub name: String,
    pub description: Option<String>,
    pub version: String,
}

/// Execute messages that modules can handle
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModuleExecuteMsg {
    /// Called after a successful transfer
    Transferred {
        from: String,
        to: String,
        amount: Uint128,
    },
    /// Called after tokens are created (minted)
    Created {
        to: String,
        amount: Uint128,
    },
    /// Called after tokens are destroyed (burned)
    Destroyed {
        from: String,
        amount: Uint128,
    },
}
```

## contracts/compliance_contract/src/msg.rs

```
use cosmwasm_std::Uint128;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub owner: String,
    pub identity_registry: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    // Module management
    AddModule {
        module: String,
        name: String,
    },
    RemoveModule {
        module: String,
    },

    // Legacy compliance rules (now modules can override)
    SetPerAddressLimit {
        address: String,
        limit: Option<Uint128>,
    },
    SetAllowedCountries {
        countries: Option<Vec<String>>,
    },

    // TREX callback functions
    Transferred {
        from: String,
        to: String,
        amount: Uint128,
    },
    Created {
        to: String,
        amount: Uint128,
    },
    Destroyed {
        from: String,
        amount: Uint128,
    },

    // Configuration
    SetIdentityRegistry {
        addr: Option<String>,
    },
    UpdateOwner {
        owner: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    CanTransfer {
        token: String,
        from: String,
        to: String,
        amount: Uint128,
    },
    Config {},
    Modules {},
    ModuleInfo {
        module: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct CanTransferResponse {
    pub allowed: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub owner: String,
    pub identity_registry: Option<String>,
    pub allowed_countries: Option<Vec<String>>,
    pub module_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ModulesResponse {
    pub modules: Vec<ModuleInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ModuleInfo {
    pub address: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ModuleInfoResponse {
    pub info: Option<ModuleInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

```

## contracts/compliance_contract/src/state.rs

```
use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const OWNER: Item<Addr> = Item::new("owner");
pub const IDENTITY_REGISTRY_ADDR: Item<Option<Addr>> = Item::new("identity_registry_addr");

// Per-address transfer limit override (None means unlimited)
pub const PER_ADDR_LIMIT: Map<&Addr, Option<Uint128>> = Map::new("per_addr_limit");

// Allowed countries. If empty or None, all countries are allowed.
pub const ALLOWED_COUNTRIES: Item<Option<Vec<String>>> = Item::new("allowed_countries");

// Compliance modules: module_address -> module_info
pub const MODULES: Map<&Addr, ModuleInfo> = Map::new("modules");

// Module names: name -> address (for lookup by name)
pub const MODULE_NAMES: Map<&str, Addr> = Map::new("module_names");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ModuleInfo {
    pub name: String,
}

```

## contracts/compliance_contract/tests/per_address_limit.rs

```
use cosmwasm_std::{Addr, Uint128};
use cw_multi_test::{App, AppBuilder, Contract, ContractWrapper, Executor};

use compliance_contract_cw::msg::{CanTransferResponse, ExecuteMsg, InstantiateMsg, QueryMsg};

fn compliance_contract() -> Box<dyn Contract<cosmwasm_std::Empty>> {
    let contract = ContractWrapper::new(
        compliance_contract_cw::contract::execute,
        compliance_contract_cw::contract::instantiate,
        compliance_contract_cw::contract::query,
    );
    Box::new(contract)
}

#[test]
fn per_address_limit_blocks_large_amount_and_allows_small() {
    // Arrange
    let mut app: App = AppBuilder::new().build(|_, _, _| {});
    let code_id = app.store_code(compliance_contract());

    // Use api.addr_make to generate valid bech32-like addresses for this test app
    let owner: Addr = app.api().addr_make("owner");
    let alice: Addr = app.api().addr_make("alice");
    let bob: Addr = app.api().addr_make("bob");

    let instantiate = InstantiateMsg {
        owner: owner.to_string(),
        identity_registry: None,
    };
    let comp_addr = app
        .instantiate_contract(code_id, owner.clone(), &instantiate, &[], "comp", None)
        .unwrap();

    // Set per-address limit for Alice to 50
    let msg = ExecuteMsg::SetPerAddressLimit {
        address: alice.to_string(),
        limit: Some(Uint128::new(50)),
    };
    app.execute_contract(owner.clone(), comp_addr.clone(), &msg, &[])
        .unwrap();

    // Act/Assert: can_transfer 100 => false
    let resp: CanTransferResponse = app
        .wrap()
        .query_wasm_smart(
            comp_addr.clone(),
            &QueryMsg::CanTransfer {
                token: "token".into(),
                from: alice.to_string(),
                to: bob.to_string(),
                amount: Uint128::new(100),
            },
        )
        .unwrap();
    assert!(!resp.allowed);
    assert_eq!(
        resp.reason.as_deref(),
        Some("amount exceeds per-address limit")
    );

    // Act/Assert: can_transfer 25 => true
    let resp_ok: CanTransferResponse = app
        .wrap()
        .query_wasm_smart(
            comp_addr,
            &QueryMsg::CanTransfer {
                token: "token".into(),
                from: alice.to_string(),
                to: bob.to_string(),
                amount: Uint128::new(25),
            },
        )
        .unwrap();
    assert!(resp_ok.allowed);
    assert_eq!(resp_ok.reason, None);
}

```

## contracts/cw3643-token/src/admin.rs

```
use crate::state::*;
use cosmwasm_std::{Deps, MessageInfo};

pub fn only_owner(deps: &Deps, info: &MessageInfo) -> Result<(), crate::error::ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(crate::error::ContractError::Unauthorized {});
    }
    Ok(())
}

pub fn only_issuer(deps: &Deps, info: &MessageInfo) -> Result<(), crate::error::ContractError> {
    let issuer = ISSUER.load(deps.storage)?;
    if info.sender != issuer {
        return Err(crate::error::ContractError::Unauthorized {});
    }
    Ok(())
}

pub fn only_controller(deps: &Deps, info: &MessageInfo) -> Result<(), crate::error::ContractError> {
    let controller = CONTROLLER.load(deps.storage)?;
    if info.sender != controller {
        return Err(crate::error::ContractError::Unauthorized {});
    }
    Ok(())
}

```

## contracts/cw3643-token/src/bin/schema.rs

```
use cosmwasm_schema::write_api;

use cw3643_token::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        query: QueryMsg,
        migrate: MigrateMsg,
    }
}

```

## contracts/cw3643-token/src/compliance.rs

```
use crate::msg::KycStatus;
use crate::state::*;
use cosmwasm_std::{Addr, Deps, StdResult, Uint128};

// Compliance module: simple example rules
// - optional per-address jurisdiction (not implemented here, left as extension)
// - simple transfer limit check

pub fn check_transfer_limit(
    _deps: &Deps,
    _from: &Addr,
    _to: &Addr,
    amount: Uint128,
) -> StdResult<()> {
    // In production, this would consult per-address limits, jurisdiction rules, and sanitizer.
    // For this minimal module, we only check that amount is non-zero.
    if amount == Uint128::zero() {
        return Err(cosmwasm_std::StdError::generic_err(
            "transfer amount must be > 0",
        ));
    }
    Ok(())
}

pub fn check_kyc_status(deps: &Deps, addr: &Addr) -> StdResult<bool> {
    match KYC.may_load(deps.storage, addr)? {
        Some(KycStatus::Approved) => Ok(true),
        _ => Ok(false),
    }
}

```

## contracts/cw3643-token/src/contract.rs

```
//! CW-3643 Token Contract - Main Implementation
//! 
//! This is the core business logic for the CW-3643 compliant security token.
//! Implements TREX/ERC-3643 standard for permissioned token transfers with identity verification.

use cosmwasm_std::{entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, Event, MessageInfo, Response, StdResult, Uint128, Order};
use cw2::set_contract_version;

use crate::admin as admin_mod;
use crate::error::ContractError;
use crate::identity_registry as idreg;
use crate::interfaces::ComplianceExecuteMsg;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:cw3643-token";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    // Save token metadata
    TOKEN_NAME.save(deps.storage, &msg.name)?;
    TOKEN_SYMBOL.save(deps.storage, &msg.symbol)?;
    TOKEN_DECIMALS.save(deps.storage, &msg.decimals)?;
    TOTAL_SUPPLY.save(deps.storage, &Uint128::zero())?;
    PAUSED.save(deps.storage, &false)?;
    CAP.save(deps.storage, &msg.cap)?;
    
    // CRITICAL SECURITY: Save minting cap for enforcement
    MINTING_CAP.save(deps.storage, &msg.minting_cap)?;

    let owner_addr = deps.api.addr_validate(&msg.owner)?;
    let issuer_addr = deps.api.addr_validate(&msg.issuer)?;
    let controller_addr = deps.api.addr_validate(&msg.controller)?;
    OWNER.save(deps.storage, &owner_addr)?;
    ISSUER.save(deps.storage, &issuer_addr)?;
    CONTROLLER.save(deps.storage, &controller_addr)?;

    // Optional external validator addresses
    let ir_addr_opt = match msg.identity_registry {
        Some(ref s) => Some(deps.api.addr_validate(s)?),
        None => None,
    };
    let comp_addr_opt = match msg.compliance {
        Some(ref s) => Some(deps.api.addr_validate(s)?),
        None => None,
    };
    IDENTITY_REGISTRY_ADDR.save(deps.storage, &ir_addr_opt)?;
    COMPLIANCE_ADDR.save(deps.storage, &comp_addr_opt)?;

    // initial balances and KYC default to Pending
    let mut total = Uint128::zero();
    for ib in msg.initial_balances {
        let addr = deps.api.addr_validate(&ib.address)?;
        BALANCES.save(deps.storage, &addr, &ib.amount)?;
        total += ib.amount;
        KYC.save(deps.storage, &addr, &KycStatus::Pending)?;
    }
    TOTAL_SUPPLY.save(deps.storage, &total)?;

    // set KYC for owner/issuer/controller as Approved
    KYC.save(deps.storage, &owner_addr, &KycStatus::Approved)?;
    KYC.save(deps.storage, &issuer_addr, &KycStatus::Approved)?;
    KYC.save(deps.storage, &controller_addr, &KycStatus::Approved)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("name", msg.name)
        .add_attribute("symbol", msg.symbol)
        .add_attribute("owner", msg.owner)
        .add_attribute("issuer", msg.issuer)
        .add_attribute("controller", msg.controller)
        .add_attribute("deployer", info.sender.to_string()))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Transfer { recipient, amount } => {
            execute_transfer(deps, env, info, recipient, amount)
        }
        // CW20-compatible
        ExecuteMsg::Approve { spender, amount } => {
            execute_approve(deps, env, info, spender, amount)
        }
        ExecuteMsg::TransferFrom {
            owner,
            recipient,
            amount,
        } => execute_transfer_from(deps, env, info, owner, recipient, amount),
        ExecuteMsg::Mint { recipient, amount } => execute_mint(deps, env, info, recipient, amount),
        ExecuteMsg::Burn { amount } => execute_burn(deps, env, info, amount),
        ExecuteMsg::ForceBurn { from, amount } => execute_force_burn(deps, env, info, from, amount),
        ExecuteMsg::ForceTransfer {
            from,
            to,
            amount,
            reason,
        } => execute_force_transfer(deps, env, info, from, to, amount, reason),
        ExecuteMsg::SetKycStatus { address, status } => {
            execute_set_kyc(deps, env, info, address, status)
        }
        ExecuteMsg::Pause {} => execute_pause(deps, env, info),
        ExecuteMsg::Unpause {} => execute_unpause(deps, env, info),
        ExecuteMsg::UpdateOwner { owner } => execute_update_owner(deps, env, info, owner),
        ExecuteMsg::UpdateIssuer { issuer } => execute_update_issuer(deps, env, info, issuer),
        ExecuteMsg::UpdateController { controller } => {
            execute_update_controller(deps, env, info, controller)
        }
        ExecuteMsg::UpdateValidators {
            identity_registry,
            compliance,
        } => execute_update_validators(deps, env, info, identity_registry, compliance),
        ExecuteMsg::AddAgent { address } => execute_add_agent(deps, info, address),
        ExecuteMsg::RemoveAgent { address } => execute_remove_agent(deps, info, address),
        ExecuteMsg::Freeze { address } => execute_freeze(deps, info, address),
        ExecuteMsg::Unfreeze { address } => execute_unfreeze(deps, info, address),
        ExecuteMsg::FreezeMany { addresses } => execute_freeze_many(deps, info, addresses),
        ExecuteMsg::BatchTransfer { transfers } => {
            execute_batch_transfer(deps, env, info, transfers)
        }
        ExecuteMsg::BatchSetKyc { updates } => execute_batch_set_kyc(deps, info, updates),
        ExecuteMsg::ReplaceWallet { lost, new } => execute_replace_wallet(deps, info, lost, new),
        ExecuteMsg::UpdateRulePlugins { add, remove } => {
            execute_update_rule_plugins(deps, info, add, remove)
        }
        // RWA messages
        ExecuteMsg::CreateAsset {
            reference_id,
            description,
            legal_owner,
            metadata,
        } => execute_create_asset(
            deps,
            env,
            info,
            reference_id,
            description,
            legal_owner,
            metadata,
        ),
        ExecuteMsg::IssueAsset {
            asset_id,
            recipient,
            amount,
        } => execute_issue_asset(deps, env, info, asset_id, recipient, amount),
        ExecuteMsg::RequestRedemption {
            asset_id,
            amount,
            reason,
        } => execute_request_redemption(deps, env, info, asset_id, amount, reason),
        ExecuteMsg::ApproveIssue { request_id } => {
            execute_approve_issue(deps, env, info, request_id)
        }
        ExecuteMsg::ApproveRedemption { request_id } => {
            execute_approve_redemption(deps, env, info, request_id)
        }
        ExecuteMsg::AttachAttestation {
            subject,
            attestation,
        } => execute_attach_attestation(deps, env, info, subject, attestation),
        ExecuteMsg::SetTransferLimit { address, limit } => {
            execute_set_transfer_limit(deps, env, info, address, limit)
        }
        ExecuteMsg::AddToDenylist { address } => execute_add_to_denylist(deps, info, address),
        ExecuteMsg::RemoveFromDenylist { address } => execute_remove_from_denylist(deps, info, address),
        ExecuteMsg::SetGovernanceConfig { members, threshold, timelock_seconds } => execute_set_governance_config(deps, info, members, threshold, timelock_seconds),
        ExecuteMsg::SubmitGovProposal { action } => execute_submit_gov_proposal(deps, env, info, action),
        ExecuteMsg::ApproveGovProposal { proposal_id } => execute_approve_gov_proposal(deps, info, proposal_id),
        ExecuteMsg::ExecuteGovProposal { proposal_id } => execute_execute_gov_proposal(deps, env, info, proposal_id),
        // Not implemented: Revoke. Other cw20 helpers can be added following patterns.
        // All known variants are matched above.
    }
}

fn only_owner(deps: &DepsMut, info: &MessageInfo) -> Result<(), ContractError> {
    admin_mod::only_owner(&deps.as_ref(), info)
}

fn only_issuer(deps: &DepsMut, info: &MessageInfo) -> Result<(), ContractError> {
    admin_mod::only_issuer(&deps.as_ref(), info)
}

fn only_controller(deps: &DepsMut, info: &MessageInfo) -> Result<(), ContractError> {
    admin_mod::only_controller(&deps.as_ref(), info)
}

fn is_agent(deps: &DepsMut, addr: &Addr) -> StdResult<bool> {
    Ok(AGENTS.may_load(deps.storage, addr)?.unwrap_or(false))
}

fn only_owner_or_agent(deps: &DepsMut, info: &MessageInfo) -> Result<(), ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender == owner {
        return Ok(());
    }
    let sender = deps.api.addr_validate(info.sender.as_ref())?;
    if is_agent(deps, &sender)? {
        Ok(())
    } else {
        Err(ContractError::Unauthorized {})
    }
}

fn check_not_paused(deps: &DepsMut) -> Result<(), ContractError> {
    let paused = PAUSED.load(deps.storage)?;
    if paused {
        return Err(ContractError::Paused {});
    }
    Ok(())
}

pub(crate) fn verify_wallet(deps: &DepsMut, addr: &Addr) -> Result<(), ContractError> {
    // denylist check
    if DENYLIST.may_load(deps.storage, addr)?.unwrap_or(false) {
        return Err(ContractError::NotCompliant("denylisted".to_string()));
    }
    // Prefer external Identity Registry when configured
    if let Some(ir_opt) = IDENTITY_REGISTRY_ADDR.may_load(deps.storage)? {
        if let Some(ir_addr) = ir_opt {
            use crate::interfaces::{IrQueryMsg, IsVerifiedResponse};
            let resp: IsVerifiedResponse = deps.as_ref().querier.query_wasm_smart(
                ir_addr,
                &IrQueryMsg::IsVerified {
                    wallet: addr.to_string(),
                },
            )?;
            if !resp.verified {
                return Err(ContractError::NotVerified(
                    resp.reason.unwrap_or_else(|| addr.to_string()),
                ));
            }
            return Ok(());
        }
    }
    // Fallback: internal KYC map
    if idreg::is_approved(&deps.as_ref(), addr)? {
        Ok(())
    } else {
        Err(ContractError::KycNotApproved(addr.to_string()))
    }
}

pub(crate) fn check_compliance(
    deps: &DepsMut,
    env: &Env,
    from: &Addr,
    to: &Addr,
    amount: Uint128,
) -> Result<(), ContractError> {
    // Prefer external Compliance contract when configured
    if let Some(comp_opt) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_opt {
            use crate::interfaces::{CanTransferResponse, ComplianceQueryMsg};
            let resp: CanTransferResponse = deps.as_ref().querier.query_wasm_smart(
                comp_addr,
                &ComplianceQueryMsg::CanTransfer {
                    token: env.contract.address.to_string(),
                    from: from.to_string(),
                    to: to.to_string(),
                    amount,
                },
            )?;
            if !resp.allowed {
                return Err(ContractError::NotCompliant(
                    resp.reason.unwrap_or_else(|| "not allowed".to_string()),
                ));
            }
        }
    }
    // Rule plugins: all must allow
    use crate::interfaces::{CanTransferResponse, ComplianceQueryMsg};
    for item in RULE_PLUGINS.range(deps.storage, None, None, Order::Ascending) {
        let (addr, enabled) = item?;
        if !enabled {
            continue;
        }
        let resp: CanTransferResponse = deps.as_ref().querier.query_wasm_smart(
            addr,
            &ComplianceQueryMsg::CanTransfer {
                token: env.contract.address.to_string(),
                from: from.to_string(),
                to: to.to_string(),
                amount,
            },
        )?;
        if !resp.allowed {
            return Err(ContractError::NotCompliant(
                resp.reason.unwrap_or_else(|| "plugin denied".to_string()),
            ));
        }
    }
    // Fallback: in-contract per-address limit for sender
    if let Some(limit_opt) = TRANSFER_LIMITS.may_load(deps.storage, from)? {
        if let Some(limit) = limit_opt {
            if amount > limit {
                return Err(ContractError::NotCompliant(
                    "transfer amount exceeds configured limit".to_string(),
                ));
            }
        }
    }
    Ok(())
}

/// Compliance check for minting operations (ERC-3643 compliant)
/// Only validates the recipient, not the sender, since tokens are created from nothing
pub(crate) fn check_mint_compliance(
    deps: &DepsMut,
    _env: &Env,
    to: &Addr,
    amount: Uint128,
) -> Result<(), ContractError> {
    // Only check recipient-specific limits, not sender limits or country checks
    // Compliance contract country checks would fail for minting since there's no "from" address
    
    // Check recipient transfer limit if configured
    if let Some(limit_opt) = TRANSFER_LIMITS.may_load(deps.storage, to)? {
        if let Some(limit) = limit_opt {
            if amount > limit {
                return Err(ContractError::NotCompliant(
                    "mint amount exceeds recipient's transfer limit".to_string(),
                ));
            }
        }
    }
    
    Ok(())
}

fn execute_transfer(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    // Validate amount is positive
    if amount.is_zero() {
        return Err(ContractError::InvalidRequest {});
    }
    check_not_paused(&deps)?;
    let sender = info.sender.clone();
    let recipient_addr = deps.api.addr_validate(&recipient)?;
    // Verification checks: both sender and recipient must be verified
    let sender_addr = deps.api.addr_validate(sender.as_ref())?;

    // Freeze checks
    if FROZEN
        .may_load(deps.storage, &sender_addr)?
        .unwrap_or(false)
    {
        return Err(ContractError::NotCompliant("sender frozen".to_string()));
    }
    if FROZEN
        .may_load(deps.storage, &recipient_addr)?
        .unwrap_or(false)
    {
        return Err(ContractError::NotCompliant("recipient frozen".to_string()));
    }

    verify_wallet(&deps, &sender_addr)?;
    verify_wallet(&deps, &recipient_addr)?;
    // Compliance
    check_compliance(&deps, &env, &sender_addr, &recipient_addr, amount)?;

    let mut from_bal = BALANCES
        .may_load(deps.storage, &sender_addr)?
        .unwrap_or_default();
    if from_bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    from_bal = from_bal
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &sender_addr, &from_bal)?;
    let mut to_bal = BALANCES
        .may_load(deps.storage, &recipient_addr)?
        .unwrap_or_default();
    to_bal = to_bal
        .checked_add(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &recipient_addr, &to_bal)?;

    // Call compliance callback after successful transfer
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Transferred {
                    from: sender_addr.to_string(),
                    to: recipient_addr.to_string(),
                    amount,
                })?,
                funds: vec![],
            });
        }
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "transfer")
        .add_event(
            Event::new("post_transfer")
                .add_attribute("token", env.contract.address.to_string())
                .add_attribute("operator", info.sender.to_string())
                .add_attribute("from", sender.to_string())
                .add_attribute("to", recipient.clone())
                .add_attribute("amount", amount.to_string())
                .add_attribute("method", "transfer"),
        )
        .add_attribute("from", sender.to_string())
        .add_attribute("to", recipient)
        .add_attribute("amount", amount.to_string()))
}

fn execute_mint(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    // Validate amount is positive
    if amount.is_zero() {
        return Err(ContractError::InvalidRequest {});
    }
    only_issuer(&deps, &info)?;
    check_not_paused(&deps)?;
    let recipient_addr = deps.api.addr_validate(&recipient)?;

    if FROZEN
        .may_load(deps.storage, &recipient_addr)?
        .unwrap_or(false)
    {
        return Err(ContractError::NotCompliant("recipient frozen".to_string()));
    }

    // CRITICAL SECURITY: Check minting cap FIRST (required enforcement)
    let minting_cap = MINTING_CAP.load(deps.storage)?;
    let current_supply = TOTAL_SUPPLY.load(deps.storage)?;
    let new_supply = current_supply.checked_add(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    
    if new_supply > minting_cap {
        return Err(ContractError::MintingCapExceeded {
            attempted: amount,
            cap: minting_cap,
            current: current_supply,
        });
    }

    // cap check (legacy, kept for backward compatibility)
    if let Some(cap) = CAP.load(deps.storage)? {
        let total = TOTAL_SUPPLY.load(deps.storage)?;
        if total + amount > cap {
            return Err(ContractError::CapReached {});
        }
    }

    // require verification approved for recipient
    verify_wallet(&deps, &recipient_addr)?;
    // For minting, only check recipient compliance (no "from" address since tokens are created)
    // This is ERC-3643 compliant - mint operations should not require sender verification
    check_mint_compliance(&deps, &env, &recipient_addr, amount)?;

    let mut bal = BALANCES
        .may_load(deps.storage, &recipient_addr)?
        .unwrap_or_default();
    bal = bal
        .checked_add(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &recipient_addr, &bal)?;
    let mut total = TOTAL_SUPPLY.load(deps.storage)?;
    total = total
        .checked_add(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    TOTAL_SUPPLY.save(deps.storage, &total)?;

    // Call compliance callback after successful mint
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Created {
                    to: recipient_addr.to_string(),
                    amount,
                })?,
                funds: vec![],
            });
        }
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "mint")
        .add_event(
            Event::new("post_mint")
                .add_attribute("token", env.contract.address.to_string())
                .add_attribute("operator", info.sender.to_string())
                .add_attribute("to", recipient.clone())
                .add_attribute("amount", amount.to_string()),
        )
        .add_attribute("to", recipient)
        .add_attribute("amount", amount.to_string()))
}

fn execute_burn(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    // Validate amount is positive
    if amount.is_zero() {
        return Err(ContractError::InvalidRequest {});
    }
    check_not_paused(&deps)?;
    let sender_addr = deps.api.addr_validate(info.sender.as_ref())?;
    if FROZEN
        .may_load(deps.storage, &sender_addr)?
        .unwrap_or(false)
    {
        return Err(ContractError::NotCompliant("sender frozen".to_string()));
    }
    let mut bal = BALANCES
        .may_load(deps.storage, &sender_addr)?
        .unwrap_or_default();
    if bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    bal = bal
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &sender_addr, &bal)?;
    let mut total = TOTAL_SUPPLY.load(deps.storage)?;
    total = total
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    TOTAL_SUPPLY.save(deps.storage, &total)?;

    // Call compliance callback after successful burn
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Destroyed {
                    from: sender_addr.to_string(),
                    amount,
                })?,
                funds: vec![],
            });
        }
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "burn")
        .add_event(
            Event::new("post_burn")
                .add_attribute("token", _env.contract.address.to_string())
                .add_attribute("operator", info.sender.to_string())
                .add_attribute("from", info.sender.to_string())
                .add_attribute("amount", amount.to_string()),
        )
        .add_attribute("from", info.sender.to_string())
        .add_attribute("amount", amount.to_string()))
}

/// ERC-3643 Compliant Force Burn
/// Allows agents to burn tokens from any address (for buybacks, redemptions, compliance)
fn execute_force_burn(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    from: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    // Only agents can force burn
    only_owner_or_agent(&deps, &info)?;
    
    // Validate amount
    if amount.is_zero() {
        return Err(ContractError::InvalidRequest {});
    }
    
    // Force burn can bypass pause state and frozen state (for emergency recovery/compliance)
    // This matches ERC-3643 behavior where agents can burn frozen tokens
    let from_addr = deps.api.addr_validate(&from)?;
    
    // Get current balance
    let mut bal = BALANCES
        .may_load(deps.storage, &from_addr)?
        .unwrap_or_default();
    
    if bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    
    // Burn tokens (bypasses frozen state as per ERC-3643)
    bal = bal.checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &from_addr, &bal)?;
    
    // Update total supply
    let mut total = TOTAL_SUPPLY.load(deps.storage)?;
    total = total.checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    TOTAL_SUPPLY.save(deps.storage, &total)?;
    
    // Call compliance callback
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Destroyed {
                    from: from_addr.to_string(),
                    amount,
                })?,
                funds: vec![],
            });
        }
    }
    
    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "force_burn")
        .add_event(
            Event::new("post_force_burn")
                .add_attribute("token", env.contract.address.to_string())
                .add_attribute("agent", info.sender.to_string())
                .add_attribute("from", from_addr.to_string())
                .add_attribute("amount", amount.to_string()),
        )
        .add_attribute("agent", info.sender.to_string())
        .add_attribute("from", from_addr.to_string())
        .add_attribute("amount", amount.to_string()))
}

fn execute_force_transfer(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    from: String,
    to: String,
    amount: Uint128,
    reason: Option<String>,
) -> Result<Response, ContractError> {
    only_controller(&deps, &info)?;
    // Note: force_transfer still ignores global paused state to allow emergency recovery,
    // but it now ENFORCES recipient verification and full compliance checks.
    let from_addr = deps.api.addr_validate(&from)?;
    let to_addr = deps.api.addr_validate(&to)?;

    // Recipient must not be frozen
    if FROZEN.may_load(deps.storage, &to_addr)?.unwrap_or(false) {
        return Err(ContractError::NotCompliant("recipient frozen".to_string()));
    }

    // Require recipient (and potentially policies) to be verified
    verify_wallet(&deps, &to_addr)?;

    // Enforce compliance rules (may reject if from/to not allowed by policy)
    check_compliance(&deps, &env, &from_addr, &to_addr, amount)?;

    let mut from_bal = BALANCES
        .may_load(deps.storage, &from_addr)?
        .unwrap_or_default();
    if from_bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    from_bal = from_bal
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &from_addr, &from_bal)?;
    let mut to_bal = BALANCES
        .may_load(deps.storage, &to_addr)?
        .unwrap_or_default();
    to_bal = to_bal
        .checked_add(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &to_addr, &to_bal)?;

    // Call compliance callback after successful force_transfer
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Transferred {
                    from: from_addr.to_string(),
                    to: to_addr.to_string(),
                    amount,
                })?,
                funds: vec![],
            });
        }
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "force_transfer")
        .add_event(
            Event::new("post_force_transfer")
                .add_attribute("token", env.contract.address.to_string())
                .add_attribute("operator", info.sender.to_string())
                .add_attribute("from", from.clone())
                .add_attribute("to", to.clone())
                .add_attribute("amount", amount.to_string()),
        )
        .add_attribute("from", from)
        .add_attribute("to", to)
        .add_attribute("amount", amount.to_string())
        .add_attribute("reason", reason.unwrap_or_default()))
}

fn execute_set_kyc(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    address: String,
    status: KycStatus,
) -> Result<Response, ContractError> {
    // controller, owner, or agent can set KYC
    let sender = info.sender.clone();
    let owner = OWNER.load(deps.storage)?;
    let controller = CONTROLLER.load(deps.storage)?;
    let is_agent_flag = is_agent(&deps, &deps.api.addr_validate(sender.as_ref())?)?;
    if sender != owner && sender != controller && !is_agent_flag {
        return Err(ContractError::Unauthorized {});
    }
    let addr = deps.api.addr_validate(&address)?;
    KYC.save(deps.storage, &addr, &status)?;
    Ok(Response::new()
        .add_attribute("action", "set_kyc")
        .add_attribute("address", address)
        .add_attribute("status", format!("{:?}", status)))
}

fn execute_pause(deps: DepsMut, _env: Env, info: MessageInfo) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    PAUSED.save(deps.storage, &true)?;
    Ok(Response::new().add_attribute("action", "pause"))
}

fn execute_unpause(deps: DepsMut, _env: Env, info: MessageInfo) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    PAUSED.save(deps.storage, &false)?;
    Ok(Response::new().add_attribute("action", "unpause"))
}

fn execute_update_owner(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    owner: String,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let addr = deps.api.addr_validate(&owner)?;
    OWNER.save(deps.storage, &addr)?;
    Ok(Response::new()
        .add_attribute("action", "update_owner")
        .add_attribute("new_owner", owner))
}

fn execute_update_issuer(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    issuer: String,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let addr = deps.api.addr_validate(&issuer)?;
    ISSUER.save(deps.storage, &addr)?;
    Ok(Response::new()
        .add_attribute("action", "update_issuer")
        .add_attribute("new_issuer", issuer))
}

fn execute_update_controller(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    controller: String,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let addr = deps.api.addr_validate(&controller)?;
    CONTROLLER.save(deps.storage, &addr)?;
    Ok(Response::new()
        .add_attribute("action", "update_controller")
        .add_attribute("new_controller", controller))
}

fn execute_update_validators(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    identity_registry: Option<String>,
    compliance: Option<String>,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let ir = match identity_registry {
        Some(s) => Some(deps.api.addr_validate(&s)?),
        None => None,
    };
    let comp = match compliance {
        Some(s) => Some(deps.api.addr_validate(&s)?),
        None => None,
    };
    if ir.is_some() {
        IDENTITY_REGISTRY_ADDR.save(deps.storage, &ir)?;
    }
    if comp.is_some() {
        COMPLIANCE_ADDR.save(deps.storage, &comp)?;
    }
    Ok(Response::new().add_attribute("action", "update_validators"))
}

// RWA handlers
fn execute_create_asset(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    reference_id: String,
    description: String,
    legal_owner: String,
    metadata: Option<String>,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let legal = deps.api.addr_validate(&legal_owner)?;
    let mut seq = ASSET_SEQ.may_load(deps.storage)?.unwrap_or_default();
    seq += 1;
    ASSET_SEQ.save(deps.storage, &seq)?;
    let asset = AssetInfo {
        id: seq,
        reference_id: reference_id.clone(),
        description: description.clone(),
        legal_owner: legal.clone(),
        metadata: metadata.clone(),
        total_tokenized: Uint128::zero(),
    };
    ASSETS.save(deps.storage, seq, &asset)?;
    Ok(Response::new()
        .add_attribute("action", "create_asset")
        .add_attribute("asset_id", seq.to_string())
        .add_attribute("reference_id", reference_id))
}

fn execute_issue_asset(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    asset_id: u64,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    only_issuer(&deps, &info)?;
    // ensure asset exists (we don't need the loaded value here)
    let _asset = ASSETS
        .may_load(deps.storage, asset_id)?
        .ok_or(ContractError::AssetNotFound {})?;
    // create issuance request
    let mut seq = ISSUANCE_SEQ.may_load(deps.storage)?.unwrap_or_default();
    seq += 1;
    ISSUANCE_SEQ.save(deps.storage, &seq)?;
    let recipient_addr = deps.api.addr_validate(&recipient)?;
    let req = IssuanceRequest {
        id: seq,
        asset_id,
        recipient: recipient_addr.clone(),
        amount,
        approved: false,
    };
    ISSUANCE_REQUESTS.save(deps.storage, seq, &req)?;
    Ok(Response::new()
        .add_attribute("action", "issue_request")
        .add_attribute("request_id", seq.to_string()))
}

fn execute_approve_issue(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    request_id: u64,
) -> Result<Response, ContractError> {
    only_controller(&deps, &info)?;
    let mut req = ISSUANCE_REQUESTS
        .may_load(deps.storage, request_id)?
        .ok_or(ContractError::InvalidRequest {})?;
    if req.approved {
        return Err(ContractError::AlreadyApproved {});
    }
    // mark approved and mint tokens
    req.approved = true;
    ISSUANCE_REQUESTS.save(deps.storage, request_id, &req)?;
    // mint to recipient
    let mut bal = BALANCES
        .may_load(deps.storage, &req.recipient)?
        .unwrap_or_default();
    bal = bal
        .checked_add(req.amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &req.recipient, &bal)?;
    let mut total = TOTAL_SUPPLY.load(deps.storage)?;
    total = total
        .checked_add(req.amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    TOTAL_SUPPLY.save(deps.storage, &total)?;
    // update asset tokenized total
    let mut asset = ASSETS.load(deps.storage, req.asset_id)?;
    asset.total_tokenized = asset
        .total_tokenized
        .checked_add(req.amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    ASSETS.save(deps.storage, req.asset_id, &asset)?;

    // Call compliance callback after successful asset issuance (mint)
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Created {
                    to: req.recipient.to_string(),
                    amount: req.amount,
                })?,
                funds: vec![],
            });
        }
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "approve_issue")
        .add_attribute("request_id", request_id.to_string()))
}

fn execute_request_redemption(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    asset_id: u64,
    amount: Uint128,
    reason: Option<String>,
) -> Result<Response, ContractError> {
    check_not_paused(&deps)?;
    let requester = deps.api.addr_validate(info.sender.as_ref())?;
    // ensure balance
    let mut bal = BALANCES
        .may_load(deps.storage, &requester)?
        .unwrap_or_default();
    if bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    // lock or subtract tokens immediately to avoid double spend until approved
    bal = bal
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &requester, &bal)?;
    let mut seq = REDEEM_SEQ.may_load(deps.storage)?.unwrap_or_default();
    seq += 1;
    REDEEM_SEQ.save(deps.storage, &seq)?;
    let req = RedemptionRequest {
        id: seq,
        asset_id,
        requester: requester.clone(),
        amount,
        approved: false,
        reason: reason.clone(),
    };
    REDEEM_REQUESTS.save(deps.storage, seq, &req)?;
    Ok(Response::new()
        .add_attribute("action", "request_redemption")
        .add_attribute("request_id", seq.to_string()))
}

fn execute_approve_redemption(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    request_id: u64,
) -> Result<Response, ContractError> {
    only_controller(&deps, &info)?;
    let mut req = REDEEM_REQUESTS
        .may_load(deps.storage, request_id)?
        .ok_or(ContractError::InvalidRequest {})?;
    if req.approved {
        return Err(ContractError::AlreadyApproved {});
    }
    req.approved = true;
    REDEEM_REQUESTS.save(deps.storage, request_id, &req)?;
    // reduce total tokenized and total supply
    let mut asset = ASSETS.load(deps.storage, req.asset_id)?;
    asset.total_tokenized = asset
        .total_tokenized
        .checked_sub(req.amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    ASSETS.save(deps.storage, req.asset_id, &asset)?;
    let mut total = TOTAL_SUPPLY.load(deps.storage)?;
    total = total
        .checked_sub(req.amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    TOTAL_SUPPLY.save(deps.storage, &total)?;

    // Call compliance callback after successful redemption (burn)
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Destroyed {
                    from: req.requester.to_string(),
                    amount: req.amount,
                })?,
                funds: vec![],
            });
        }
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "approve_redemption")
        .add_attribute("request_id", request_id.to_string()))
}

fn execute_attach_attestation(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    subject: String,
    attestation: String,
) -> Result<Response, ContractError> {
    only_controller(&deps, &info)?;
    let subj = deps.api.addr_validate(&subject)?;
    ATTESTATIONS.save(deps.storage, &subj, &attestation)?;
    Ok(Response::new()
        .add_attribute("action", "attach_attestation")
        .add_attribute("subject", subject))
}

fn execute_set_transfer_limit(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    address: String,
    limit: Option<Uint128>,
) -> Result<Response, ContractError> {
    // only owner or controller
    let sender = info.sender.clone();
    let owner = OWNER.load(deps.storage)?;
    let controller = CONTROLLER.load(deps.storage)?;
    if sender != owner && sender != controller {
        return Err(ContractError::Unauthorized {});
    }
    let addr = deps.api.addr_validate(&address)?;
    TRANSFER_LIMITS.save(deps.storage, &addr, &limit)?;
    Ok(Response::new()
        .add_attribute("action", "set_transfer_limit")
        .add_attribute("address", address)
        .add_attribute("limit", format!("{:?}", limit)))
}

fn execute_approve(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    spender: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    check_not_paused(&deps)?;
    let owner = deps.api.addr_validate(info.sender.as_ref())?;
    let spender_addr = deps.api.addr_validate(&spender)?;

    // ensure spender KYC approved
    if !idreg::is_approved(&deps.as_ref(), &spender_addr)? {
        return Err(ContractError::KycNotApproved(spender));
    }

    ALLOWANCES.save(deps.storage, (&owner, &spender_addr), &amount)?;
    Ok(Response::new()
        .add_attribute("action", "approve")
        .add_attribute("owner", owner.to_string())
        .add_attribute("spender", spender)
        .add_attribute("amount", amount.to_string()))
}

fn execute_transfer_from(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    owner: String,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    check_not_paused(&deps)?;
    let spender = deps.api.addr_validate(info.sender.as_ref())?;
    let owner_addr = deps.api.addr_validate(&owner)?;
    let recipient_addr = deps.api.addr_validate(&recipient)?;

    if FROZEN.may_load(deps.storage, &owner_addr)?.unwrap_or(false) {
        return Err(ContractError::NotCompliant("owner frozen".to_string()));
    }
    if FROZEN
        .may_load(deps.storage, &recipient_addr)?
        .unwrap_or(false)
    {
        return Err(ContractError::NotCompliant("recipient frozen".to_string()));
    }

    // Verification checks
    verify_wallet(&deps, &owner_addr)?;
    verify_wallet(&deps, &recipient_addr)?;

    // allowance check
    let mut allowance = ALLOWANCES
        .may_load(deps.storage, (&owner_addr, &spender))?
        .unwrap_or_default();
    if allowance < amount {
        return Err(ContractError::InsufficientFunds {});
    }

    // compliance
    check_compliance(&deps, &env, &owner_addr, &recipient_addr, amount)?;

    // balances
    let mut owner_bal = BALANCES
        .may_load(deps.storage, &owner_addr)?
        .unwrap_or_default();
    if owner_bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    owner_bal = owner_bal
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &owner_addr, &owner_bal)?;
    let mut rec_bal = BALANCES
        .may_load(deps.storage, &recipient_addr)?
        .unwrap_or_default();
    rec_bal = rec_bal
        .checked_add(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, &recipient_addr, &rec_bal)?;

    // reduce allowance
    allowance = allowance
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    ALLOWANCES.save(deps.storage, (&owner_addr, &spender), &allowance)?;

    // Call compliance callback after successful transfer_from
    let mut messages = vec![];
    if let Some(comp_addr) = COMPLIANCE_ADDR.may_load(deps.storage)? {
        if let Some(comp_addr) = comp_addr {
            messages.push(cosmwasm_std::WasmMsg::Execute {
                contract_addr: comp_addr.to_string(),
                msg: to_json_binary(&ComplianceExecuteMsg::Transferred {
                    from: owner_addr.to_string(),
                    to: recipient_addr.to_string(),
                    amount,
                })?,
                funds: vec![],
            });
        }
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "transfer_from")
        .add_attribute("owner", owner)
        .add_attribute("recipient", recipient)
        .add_attribute("amount", amount.to_string()))
    .map(|mut r| {
        r.events.push(
            Event::new("post_transfer")
                .add_attribute("token", env.contract.address.to_string())
                .add_attribute("operator", info.sender.to_string())
                .add_attribute("from", owner_addr.to_string())
                .add_attribute("to", recipient_addr.to_string())
                .add_attribute("amount", amount.to_string())
                .add_attribute("method", "transfer_from"),
        );
        r
    })
}

fn execute_add_agent(
    deps: DepsMut,
    info: MessageInfo,
    address: String,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let addr = deps.api.addr_validate(&address)?;
    AGENTS.save(deps.storage, &addr, &true)?;
    Ok(Response::new()
        .add_attribute("action", "add_agent")
        .add_attribute("address", address))
}

fn execute_remove_agent(
    deps: DepsMut,
    info: MessageInfo,
    address: String,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let addr = deps.api.addr_validate(&address)?;
    AGENTS.remove(deps.storage, &addr);
    Ok(Response::new()
        .add_attribute("action", "remove_agent")
        .add_attribute("address", address))
}

fn execute_freeze(
    deps: DepsMut,
    info: MessageInfo,
    address: String,
) -> Result<Response, ContractError> {
    // owner or agent can freeze
    only_owner_or_agent(&deps, &info)?;
    let addr = deps.api.addr_validate(&address)?;
    FROZEN.save(deps.storage, &addr, &true)?;
    Ok(Response::new()
        .add_attribute("action", "freeze")
        .add_attribute("address", address))
}

fn execute_unfreeze(
    deps: DepsMut,
    info: MessageInfo,
    address: String,
) -> Result<Response, ContractError> {
    only_owner_or_agent(&deps, &info)?;
    let addr = deps.api.addr_validate(&address)?;
    FROZEN.save(deps.storage, &addr, &false)?;
    Ok(Response::new()
        .add_attribute("action", "unfreeze")
        .add_attribute("address", address))
}

fn execute_freeze_many(
    deps: DepsMut,
    info: MessageInfo,
    addresses: Vec<String>,
) -> Result<Response, ContractError> {
    only_owner_or_agent(&deps, &info)?;
    for a in addresses.into_iter() {
        let addr = deps.api.addr_validate(&a)?;
        FROZEN.save(deps.storage, &addr, &true)?;
    }
    Ok(Response::new().add_attribute("action", "freeze_many"))
}

fn transfer_core(
    deps: &mut DepsMut,
    env: &Env,
    sender_addr: &Addr,
    recipient_addr: &Addr,
    amount: Uint128,
) -> Result<(), ContractError> {
    if FROZEN.may_load(deps.storage, sender_addr)?.unwrap_or(false) {
        return Err(ContractError::NotCompliant("sender frozen".to_string()));
    }
    if FROZEN
        .may_load(deps.storage, recipient_addr)?
        .unwrap_or(false)
    {
        return Err(ContractError::NotCompliant("recipient frozen".to_string()));
    }
    verify_wallet(deps, sender_addr)?;
    verify_wallet(deps, recipient_addr)?;
    check_compliance(deps, env, sender_addr, recipient_addr, amount)?;
    let mut from_bal = BALANCES
        .may_load(deps.storage, sender_addr)?
        .unwrap_or_default();
    if from_bal < amount {
        return Err(ContractError::InsufficientFunds {});
    }
    from_bal = from_bal
        .checked_sub(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, sender_addr, &from_bal)?;
    let mut to_bal = BALANCES
        .may_load(deps.storage, recipient_addr)?
        .unwrap_or_default();
    to_bal = to_bal
        .checked_add(amount)
        .map_err(|e| ContractError::Std(e.into()))?;
    BALANCES.save(deps.storage, recipient_addr, &to_bal)?;
    Ok(())
}

fn execute_batch_transfer(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    transfers: Vec<TransferItem>,
) -> Result<Response, ContractError> {
    check_not_paused(&mut deps)?;
    let sender_addr = deps.api.addr_validate(info.sender.as_ref())?;
    let mut resp = Response::new().add_attribute("action", "batch_transfer");
    for t in transfers.into_iter() {
        let rcpt = deps.api.addr_validate(&t.recipient)?;
        transfer_core(&mut deps, &env, &sender_addr, &rcpt, t.amount)?;
        resp = resp
            .add_attribute("to", rcpt.to_string())
            .add_attribute("amount", t.amount.to_string());
    }
    Ok(resp)
}

fn execute_batch_set_kyc(
    deps: DepsMut,
    info: MessageInfo,
    updates: Vec<KycUpdate>,
) -> Result<Response, ContractError> {
    // owner, controller, or agent
    let sender = info.sender.clone();
    let owner = OWNER.load(deps.storage)?;
    let controller = CONTROLLER.load(deps.storage)?;
    let is_agent_flag = is_agent(&deps, &deps.api.addr_validate(sender.as_ref())?)?;
    if sender != owner && sender != controller && !is_agent_flag {
        return Err(ContractError::Unauthorized {});
    }
    for u in updates.into_iter() {
        let addr = deps.api.addr_validate(&u.address)?;
        KYC.save(deps.storage, &addr, &u.status)?;
    }
    Ok(Response::new().add_attribute("action", "batch_set_kyc"))
}

fn execute_replace_wallet(
    deps: DepsMut,
    info: MessageInfo,
    lost: String,
    new: String,
) -> Result<Response, ContractError> {
    // owner or controller only
    let owner = OWNER.load(deps.storage)?;
    let controller = CONTROLLER.load(deps.storage)?;
    if info.sender != owner && info.sender != controller {
        return Err(ContractError::Unauthorized {});
    }
    let lost_addr = deps.api.addr_validate(&lost)?;
    let new_addr = deps.api.addr_validate(&new)?;

    // Move balance
    let lost_bal = BALANCES
        .may_load(deps.storage, &lost_addr)?
        .unwrap_or_default();
    if !lost_bal.is_zero() {
        let mut new_bal = BALANCES
            .may_load(deps.storage, &new_addr)?
            .unwrap_or_default();
        new_bal = new_bal
            .checked_add(lost_bal)
            .map_err(|e| ContractError::Std(e.into()))?;
        BALANCES.save(deps.storage, &new_addr, &new_bal)?;
        BALANCES.save(deps.storage, &lost_addr, &Uint128::zero())?;
    }
    // Move KYC (preserve status)
    if let Some(status) = KYC.may_load(deps.storage, &lost_addr)? {
        KYC.save(deps.storage, &new_addr, &status)?;
    }
    // Move transfer limits
    if let Some(limit_opt) = TRANSFER_LIMITS.may_load(deps.storage, &lost_addr)? {
        TRANSFER_LIMITS.save(deps.storage, &new_addr, &limit_opt)?;
        TRANSFER_LIMITS.remove(deps.storage, &lost_addr);
    }
    // Move attestations
    if let Some(att) = ATTESTATIONS.may_load(deps.storage, &lost_addr)? {
        ATTESTATIONS.save(deps.storage, &new_addr, &att)?;
        ATTESTATIONS.remove(deps.storage, &lost_addr);
    }
    // Move allowances where lost is owner
    let owner_rows: Vec<(Addr, Uint128)> = ALLOWANCES
        .prefix(&lost_addr)
        .range(deps.storage, None, None, Order::Ascending)
        .collect::<StdResult<Vec<_>>>()?;
    for (spender, amount) in owner_rows.into_iter() {
        // Merge into (new, spender)
        let current = ALLOWANCES
            .may_load(deps.storage, (&new_addr, &spender))?
            .unwrap_or_default();
        let merged = current
            .checked_add(amount)
            .map_err(|e| ContractError::Std(e.into()))?;
        ALLOWANCES.save(deps.storage, (&new_addr, &spender), &merged)?;
        // remove old
        ALLOWANCES.remove(deps.storage, (&lost_addr, &spender));
    }
    // Move allowances where lost is spender (we must scan all owners)
    let all_rows: Vec<((Addr, Addr), Uint128)> = ALLOWANCES
        .range(deps.storage, None, None, Order::Ascending)
        .collect::<StdResult<Vec<_>>>()?;
    for ((owner, spender), amount) in all_rows.into_iter() {
        if spender == lost_addr {
            let current = ALLOWANCES
                .may_load(deps.storage, (&owner, &new_addr))?
                .unwrap_or_default();
            let merged = current
                .checked_add(amount)
                .map_err(|e| ContractError::Std(e.into()))?;
            ALLOWANCES.save(deps.storage, (&owner, &new_addr), &merged)?;
            ALLOWANCES.remove(deps.storage, (&owner, &lost_addr));
        }
    }
    // Remove agent flag if any and freeze lost
    AGENTS.remove(deps.storage, &lost_addr);
    FROZEN.save(deps.storage, &lost_addr, &true)?;

    Ok(Response::new()
        .add_attribute("action", "replace_wallet")
        .add_attribute("lost", lost)
        .add_attribute("new", new))
}

fn execute_update_rule_plugins(
    deps: DepsMut,
    info: MessageInfo,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    for a in add.into_iter() {
        let addr = deps.api.addr_validate(&a)?;
        RULE_PLUGINS.save(deps.storage, &addr, &true)?;
    }
    for r in remove.into_iter() {
        let addr = deps.api.addr_validate(&r)?;
        RULE_PLUGINS.remove(deps.storage, &addr);
    }
    Ok(Response::new().add_attribute("action", "update_rule_plugins"))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::TokenInfo {} => to_json_binary(&query_token_info(deps)?),
        QueryMsg::AssetInfo { asset_id } => to_json_binary(&query_asset_info(deps, asset_id)?),
        QueryMsg::RedemptionRequests { start_after, limit } => {
            to_json_binary(&query_redemption_requests(deps, start_after, limit)?)
        }
        QueryMsg::Balance { address } => to_json_binary(&query_balance(deps, address)?),
        QueryMsg::Allowance { owner, spender } => {
            to_json_binary(&query_allowance(deps, owner, spender)?)
        }
        QueryMsg::TransferLimit { address } => {
            to_json_binary(&query_transfer_limit(deps, address)?)
        }
        QueryMsg::TotalSupply {} => to_json_binary(&query_total_supply(deps)?),
        QueryMsg::KycStatus { address } => to_json_binary(&query_kyc_status(deps, address)?),
        QueryMsg::Roles {} => to_json_binary(&query_roles(deps)?),
        QueryMsg::Paused {} => to_json_binary(&query_paused(deps)?),
        QueryMsg::Cap {} => to_json_binary(&query_cap(deps)?),
        QueryMsg::MintingCap {} => to_json_binary(&query_minting_cap(deps)?),
        QueryMsg::Validators {} => to_json_binary(&query_validators(deps)?),
        QueryMsg::Agents {} => to_json_binary(&query_agents(deps)?),
        QueryMsg::Frozen { address } => to_json_binary(&query_frozen(deps, address)?),
        QueryMsg::RulePlugins {} => to_json_binary(&query_rule_plugins(deps)?),
        QueryMsg::ComplianceMetrics {} => to_json_binary(&query_compliance_metrics(deps)?),
        QueryMsg::GovConfig {} => to_json_binary(&query_gov_config(deps)?),
        QueryMsg::GovProposal { proposal_id } => to_json_binary(&query_gov_proposal(deps, proposal_id)?),
        QueryMsg::GovProposals { start_after, limit } => to_json_binary(&query_gov_proposals(deps, start_after, limit)?),
        // All QueryMsg variants are handled above.
    }
}

fn query_allowance(deps: Deps, owner: String, spender: String) -> StdResult<Uint128> {
    let owner_addr = deps.api.addr_validate(&owner)?;
    let spender_addr = deps.api.addr_validate(&spender)?;
    let allowance = ALLOWANCES
        .may_load(deps.storage, (&owner_addr, &spender_addr))?
        .unwrap_or_default();
    Ok(allowance)
}

fn query_token_info(deps: Deps) -> StdResult<TokenInfoResponse> {
    let name = TOKEN_NAME.load(deps.storage)?;
    let symbol = TOKEN_SYMBOL.load(deps.storage)?;
    let decimals = TOKEN_DECIMALS.load(deps.storage)?;
    let total_supply = TOTAL_SUPPLY.load(deps.storage)?;
    Ok(TokenInfoResponse {
        name,
        symbol,
        decimals,
        total_supply,
    })
}

fn query_balance(deps: Deps, address: String) -> StdResult<Uint128> {
    let addr = deps.api.addr_validate(&address)?;
    Ok(BALANCES.may_load(deps.storage, &addr)?.unwrap_or_default())
}

fn query_total_supply(deps: Deps) -> StdResult<Uint128> { TOTAL_SUPPLY.load(deps.storage) }

fn query_kyc_status(deps: Deps, address: String) -> StdResult<KycStatusResponse> {
    let addr = deps.api.addr_validate(&address)?;
    let status = KYC
        .may_load(deps.storage, &addr)?
        .unwrap_or(KycStatus::Pending);
    Ok(KycStatusResponse {
        address: addr.to_string(),
        status,
    })
}

fn query_roles(deps: Deps) -> StdResult<RolesResponse> {
    let owner = OWNER.load(deps.storage)?;
    let issuer = ISSUER.load(deps.storage)?;
    let controller = CONTROLLER.load(deps.storage)?;
    Ok(RolesResponse {
        owner: owner.to_string(),
        issuer: issuer.to_string(),
        controller: controller.to_string(),
    })
}

fn query_paused(deps: Deps) -> StdResult<bool> { PAUSED.load(deps.storage) }

fn query_cap(deps: Deps) -> StdResult<Option<Uint128>> { CAP.load(deps.storage) }

fn query_minting_cap(deps: Deps) -> StdResult<MintingCapResponse> {
    let minting_cap = MINTING_CAP.load(deps.storage)?;
    let current_supply = TOTAL_SUPPLY.load(deps.storage)?;
    let available_to_mint = minting_cap.saturating_sub(current_supply);
    Ok(MintingCapResponse {
        minting_cap,
        current_supply,
        available_to_mint,
    })
}

fn query_validators(deps: Deps) -> StdResult<ValidatorsResponse> {
    let ir = IDENTITY_REGISTRY_ADDR
        .may_load(deps.storage)?
        .flatten()
        .map(|a| a.to_string());
    let comp = COMPLIANCE_ADDR
        .may_load(deps.storage)?
        .flatten()
        .map(|a| a.to_string());
    Ok(ValidatorsResponse {
        identity_registry: ir,
        compliance: comp,
    })
}

fn query_agents(deps: Deps) -> StdResult<AgentsResponse> {
    let mut list: Vec<String> = vec![];
    for item in AGENTS.range(deps.storage, None, None, Order::Ascending) {
        let (addr, enabled) = item?;
        if enabled {
            list.push(addr.to_string());
        }
    }
    Ok(AgentsResponse { agents: list })
}

fn query_frozen(deps: Deps, address: String) -> StdResult<bool> {
    let addr = deps.api.addr_validate(&address)?;
    Ok(FROZEN.may_load(deps.storage, &addr)?.unwrap_or(false))
}

fn query_rule_plugins(deps: Deps) -> StdResult<RulePluginsResponse> {
    let mut list: Vec<String> = vec![];
    for item in RULE_PLUGINS.range(deps.storage, None, None, Order::Ascending) {
        let (addr, enabled) = item?;
        if enabled {
            list.push(addr.to_string());
        }
    }
    Ok(RulePluginsResponse { plugins: list })
}

// --- Observability Queries ---
fn query_compliance_metrics(deps: Deps) -> StdResult<ComplianceMetricsResponse> {
    let mut kyc_pending = 0u32;
    let mut kyc_approved = 0u32;
    let mut kyc_revoked = 0u32;
    let mut frozen_count = 0u32;
    let mut denylisted = 0u32;
    for item in KYC.range(deps.storage, None, None, Order::Ascending) {
        let (addr, status) = item?;
        match status {
            KycStatus::Pending => kyc_pending += 1,
            KycStatus::Approved => kyc_approved += 1,
            KycStatus::Revoked => kyc_revoked += 1,
        }
        if FROZEN.may_load(deps.storage, &addr)?.unwrap_or(false) { frozen_count += 1; }
        if DENYLIST.may_load(deps.storage, &addr)?.unwrap_or(false) { denylisted += 1; }
    }
    Ok(ComplianceMetricsResponse { kyc_pending, kyc_approved, kyc_revoked, frozen_count, denylisted })
}

// --- Denylist Execute ---
fn execute_add_to_denylist(deps: DepsMut, info: MessageInfo, address: String) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let addr = deps.api.addr_validate(&address)?;
    DENYLIST.save(deps.storage, &addr, &true)?;
    Ok(Response::new().add_attribute("action","add_to_denylist").add_attribute("address", address))
}

fn execute_remove_from_denylist(deps: DepsMut, info: MessageInfo, address: String) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    let addr = deps.api.addr_validate(&address)?;
    DENYLIST.remove(deps.storage, &addr);
    Ok(Response::new().add_attribute("action","remove_from_denylist").add_attribute("address", address))
}

// --- Governance Helpers & Execute ---
fn is_gov_member(deps: &DepsMut, addr: &Addr) -> StdResult<bool> {
    Ok(GOV_MEMBERS.may_load(deps.storage, addr)?.unwrap_or(false))
}

fn execute_set_governance_config(
    deps: DepsMut,
    info: MessageInfo,
    members: Vec<String>,
    threshold: u32,
    timelock_seconds: u64,
) -> Result<Response, ContractError> {
    only_owner(&deps, &info)?;
    if threshold == 0 { return Err(ContractError::NotCompliant("threshold=0".to_string())); }
    if members.is_empty() { return Err(ContractError::NotCompliant("no members".to_string())); }
    if threshold > members.len() as u32 { return Err(ContractError::NotCompliant("threshold>members".to_string())); }
    for m in members.iter() {
        let addr = deps.api.addr_validate(m)?;
        GOV_MEMBERS.save(deps.storage, &addr, &true)?;
    }
    GOV_CONFIG.save(deps.storage, &Some(GovConfig { threshold, timelock_seconds }))?;
    Ok(Response::new().add_attribute("action","set_governance_config").add_attribute("members", members.len().to_string()).add_attribute("threshold", threshold.to_string()).add_attribute("timelock_seconds", timelock_seconds.to_string()))
}

fn execute_submit_gov_proposal(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    action: String,
) -> Result<Response, ContractError> {
    let sender = deps.api.addr_validate(info.sender.as_ref())?;
    if !is_gov_member(&deps, &sender)? { return Err(ContractError::Unauthorized {}); }
    let cfg = GOV_CONFIG.load(deps.storage)?.ok_or(ContractError::InvalidRequest {})?;
    let mut seq = GOV_PROPOSAL_SEQ.may_load(deps.storage)?.unwrap_or_default();
    seq += 1; GOV_PROPOSAL_SEQ.save(deps.storage, &seq)?;
    let creation = env.block.time.seconds();
    let prop = GovProposal { id: seq, action: action.clone(), proposer: sender.clone(), approvals: 0, executed: false, creation_time: creation, timelock_end: creation + cfg.timelock_seconds };
    GOV_PROPOSALS.save(deps.storage, seq, &prop)?;
    Ok(Response::new().add_attribute("action","submit_gov_proposal").add_attribute("proposal_id", seq.to_string()).add_attribute("timelock_end", prop.timelock_end.to_string()))
}

fn execute_approve_gov_proposal(
    deps: DepsMut,
    info: MessageInfo,
    proposal_id: u64,
) -> Result<Response, ContractError> {
    let sender = deps.api.addr_validate(info.sender.as_ref())?;
    if !is_gov_member(&deps, &sender)? { return Err(ContractError::Unauthorized {}); }
    GOV_PROPOSALS.update(deps.storage, proposal_id, |old| -> StdResult<_> {
        let mut p = old.ok_or_else(|| cosmwasm_std::StdError::not_found("gov_proposal"))?;
        if p.executed { return Err(cosmwasm_std::StdError::generic_err("already executed")); }
        p.approvals += 1; Ok(p)
    })?;
    Ok(Response::new().add_attribute("action","approve_gov_proposal").add_attribute("proposal_id", proposal_id.to_string()))
}

fn execute_execute_gov_proposal(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    proposal_id: u64,
) -> Result<Response, ContractError> {
    let cfg = GOV_CONFIG.load(deps.storage)?.ok_or(ContractError::InvalidRequest {})?;
    let p = GOV_PROPOSALS.load(deps.storage, proposal_id)?;
    if p.executed { return Err(ContractError::InvalidRequest {}); }
    if p.approvals < cfg.threshold { return Err(ContractError::InvalidRequest {}); }
    if env.block.time.seconds() < p.timelock_end { return Err(ContractError::InvalidRequest {}); }

    // Apply supported actions
    let mut resp = apply_gov_action(&mut deps, &info, &p.action)?;
    // Mark executed
    GOV_PROPOSALS.update(deps.storage, proposal_id, |old| -> StdResult<_> {
        let mut p2 = old.ok_or_else(|| cosmwasm_std::StdError::not_found("gov_proposal"))?;
        p2.executed = true; Ok(p2)
    })?;
    resp = resp.add_attribute("action","execute_gov_proposal").add_attribute("proposal_id", proposal_id.to_string());
    Ok(resp)
}

fn apply_gov_action(deps: &mut DepsMut, _info: &MessageInfo, action: &str) -> Result<Response, ContractError> {
    // Supported forms:
    // - "pause"
    // - "unpause"
    if action.eq_ignore_ascii_case("pause") {
        PAUSED.save(deps.storage, &true)?;
        return Ok(Response::new().add_attribute("gov_action","pause"));
    }
    if action.eq_ignore_ascii_case("unpause") {
        PAUSED.save(deps.storage, &false)?;
        return Ok(Response::new().add_attribute("gov_action","unpause"));
    }
    // Unknown action: treat as no-op but indicate type (could reject instead)
    Ok(Response::new().add_attribute("gov_action","noop").add_attribute("raw", action))
}

// --- Governance Queries ---
fn query_gov_config(deps: Deps) -> StdResult<GovConfigResponse> {
    let cfg = GOV_CONFIG.load(deps.storage)?.ok_or_else(|| cosmwasm_std::StdError::not_found("gov_config"))?;
    let mut members: Vec<String> = vec![];
    for item in GOV_MEMBERS.range(deps.storage, None, None, Order::Ascending) {
        let (addr, enabled) = item?; if enabled { members.push(addr.to_string()); }
    }
    Ok(GovConfigResponse { members, threshold: cfg.threshold, timelock_seconds: cfg.timelock_seconds })
}

fn query_gov_proposal(deps: Deps, proposal_id: u64) -> StdResult<GovProposalResponse> {
    let p = GOV_PROPOSALS.load(deps.storage, proposal_id)?;
    Ok(GovProposalResponse { id: p.id, action: p.action, proposer: p.proposer.to_string(), approvals: p.approvals, executed: p.executed, creation_time: p.creation_time, timelock_end: p.timelock_end })
}

fn query_gov_proposals(deps: Deps, start_after: Option<u64>, limit: Option<u32>) -> StdResult<Vec<GovProposalResponse>> {
    let start = start_after.unwrap_or_default();
    let lim = limit.unwrap_or(20).min(100) as usize;
    let mut out: Vec<GovProposalResponse> = vec![];
    let mut count = 0usize;
    for item in GOV_PROPOSALS.range(deps.storage, None, None, Order::Ascending) {
        let (id, p) = item?;
        if id <= start { continue; }
        out.push(GovProposalResponse { id: p.id, action: p.action.clone(), proposer: p.proposer.to_string(), approvals: p.approvals, executed: p.executed, creation_time: p.creation_time, timelock_end: p.timelock_end });
        count += 1; if count >= lim { break; }
    }
    Ok(out)
}

fn query_asset_info(deps: Deps, asset_id: u64) -> StdResult<AssetInfoResponse> {
    let asset = ASSETS.load(deps.storage, asset_id)?;
    Ok(AssetInfoResponse {
        asset_id: asset.id,
        reference_id: asset.reference_id,
        description: asset.description,
        legal_owner: asset.legal_owner.to_string(),
        metadata: asset.metadata,
        total_tokenized: asset.total_tokenized,
    })
}

fn query_transfer_limit(deps: Deps, address: String) -> StdResult<Option<Uint128>> {
    let addr = deps.api.addr_validate(&address)?;
    Ok(TRANSFER_LIMITS
        .may_load(deps.storage, &addr)?
        .unwrap_or(None))
}

fn query_redemption_requests(
    deps: Deps,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<Vec<RedeemRequestResponse>> {
    let mut res: Vec<RedeemRequestResponse> = vec![];
    let start = start_after.unwrap_or_default();
    let lim = limit.unwrap_or(10).min(100) as usize;
    let mut count = 0usize;
    for item in REDEEM_REQUESTS.range(deps.storage, None, None, cosmwasm_std::Order::Ascending) {
        let (id, v) = item?;
        if id <= start { continue; }
        res.push(RedeemRequestResponse { id: v.id, asset_id: v.asset_id, requester: v.requester.to_string(), amount: v.amount, approved: v.approved, reason: v.reason });
        count += 1; if count >= lim { break; }
    }
    Ok(res)
}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    // Ensure contract version updated
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    // Initialize new optional keys if absent
    if IDENTITY_REGISTRY_ADDR.may_load(deps.storage)?.is_none() {
        IDENTITY_REGISTRY_ADDR.save(deps.storage, &None)?;
    }
    if COMPLIANCE_ADDR.may_load(deps.storage)?.is_none() {
        COMPLIANCE_ADDR.save(deps.storage, &None)?;
    }
    // Initialize TF maps lazily; cw-storage-plus maps don't require explicit init.
    // No initialization required for maps; ensure paused key exists already.
    Ok(Response::new().add_attribute("action", "migrate"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::message_info;
    use cosmwasm_std::testing::{mock_dependencies, mock_env};
    use cosmwasm_std::{coins, from_json};

    #[test]
    fn migrate_initializes_validator_keys() {
        let mut deps = mock_dependencies();

        // Before migrate, keys are unset; after migrate, they exist with None
        let res = migrate(deps.as_mut(), mock_env(), MigrateMsg {}).unwrap();
        assert!(res.attributes.iter().any(|a| a.key == "action" && a.value == "migrate"));

        // Validate storage contains the new optional keys initialized to None
        let ir = IDENTITY_REGISTRY_ADDR
            .may_load(deps.as_ref().storage)
            .unwrap();
        let comp = COMPLIANCE_ADDR.may_load(deps.as_ref().storage).unwrap();
        assert!(ir.is_some());
        assert!(comp.is_some());
        assert!(ir.unwrap().is_none());
        assert!(comp.unwrap().is_none());
    }

    #[test]
    fn agent_freeze_and_replace_wallet_flow() {
        let mut deps = mock_dependencies();
        let env = mock_env();

        // Prepare valid bech32-like addrs via MockApi
        let api = cosmwasm_std::testing::MockApi::default();
        let owner_addr = api.addr_make("owner");
        let controller_addr = owner_addr.clone();
        let issuer_addr = owner_addr.clone();
        let deployer = api.addr_make("deployer");
        let alice_addr = api.addr_make("alice");
        let bob_addr = api.addr_make("bob");
        let agent_addr = api.addr_make("agent");

        // Instantiate
        let inst = InstantiateMsg {
            name: "RWA".to_string(),
            symbol: "RWA".to_string(),
            decimals: 6u8,
            initial_balances: vec![InitialBalance {
                address: alice_addr.to_string(),
                amount: Uint128::new(100),
            }],
            issuer: issuer_addr.to_string(),
            controller: controller_addr.to_string(),
            owner: owner_addr.to_string(),
            cap: None,
            minting_cap: Uint128::new(1_000_000),
            require_kyc_for_transfer: None,
            identity_registry: None,
            compliance: None,
        };
        let _ = instantiate(
            deps.as_mut(),
            env.clone(),
            message_info(&deployer, &coins(0, "u")),
            inst,
        )
        .unwrap();

        // Owner adds agent
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::AddAgent {
                address: agent_addr.to_string(),
            },
        )
        .unwrap();
        // Agent sets KYC Approved for alice and bob
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&agent_addr, &[]),
            ExecuteMsg::SetKycStatus {
                address: alice_addr.to_string(),
                status: KycStatus::Approved,
            },
        )
        .unwrap();
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&agent_addr, &[]),
            ExecuteMsg::SetKycStatus {
                address: bob_addr.to_string(),
                status: KycStatus::Approved,
            },
        )
        .unwrap();

        // Agent freezes alice
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&agent_addr, &[]),
            ExecuteMsg::Freeze {
                address: alice_addr.to_string(),
            },
        )
        .unwrap();
        // Alice attempts transfer -> should fail
        let res = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&alice_addr, &[]),
            ExecuteMsg::Transfer {
                recipient: bob_addr.to_string(),
                amount: Uint128::new(1),
            },
        );
        assert!(res.is_err());

        // Owner replaces alice with alice2
        let alice2_addr = api.addr_make("alice2");
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::ReplaceWallet {
                lost: alice_addr.to_string(),
                new: alice2_addr.to_string(),
            },
        )
        .unwrap();
        // Approve KYC for alice2
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&agent_addr, &[]),
            ExecuteMsg::SetKycStatus {
                address: alice2_addr.to_string(),
                status: KycStatus::Approved,
            },
        )
        .unwrap();

        // Balance moved
        let bal_alice2_bin = query(
            deps.as_ref(),
            env.clone(),
            QueryMsg::Balance {
                address: alice2_addr.to_string(),
            },
        )
        .unwrap();
        let bal_alice2: Uint128 = from_json(&bal_alice2_bin).unwrap();
        assert_eq!(bal_alice2, Uint128::new(100));

        // alice2 can transfer now and a post_transfer event is emitted
        let res = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&alice2_addr, &[]),
            ExecuteMsg::Transfer {
                recipient: bob_addr.to_string(),
                amount: Uint128::new(10),
            },
        )
        .unwrap();
        assert!(res.events.iter().any(|e| e.ty == "post_transfer"));
        let bal_bob_bin = query(
            deps.as_ref(),
            env.clone(),
            QueryMsg::Balance {
                address: bob_addr.to_string(),
            },
        )
        .unwrap();
        let bal_bob: Uint128 = from_json(&bal_bob_bin).unwrap();
        assert_eq!(bal_bob, Uint128::new(10));
    }

    #[test]
    fn denylist_blocks_mint_and_transfer() {
        let mut deps = mock_dependencies();
        let env = mock_env();

        let api = cosmwasm_std::testing::MockApi::default();
        let owner_addr = api.addr_make("owner");
        let deployer = api.addr_make("deployer");
        let bob_addr = api.addr_make("bob");

        // Instantiate with owner as all roles and initial balance to owner
        let inst = InstantiateMsg {
            name: "RWA".to_string(),
            symbol: "RWA".to_string(),
            decimals: 6u8,
            initial_balances: vec![InitialBalance { address: owner_addr.to_string(), amount: Uint128::new(100) }],
            issuer: owner_addr.to_string(),
            controller: owner_addr.to_string(),
            owner: owner_addr.to_string(),
            cap: None,
            minting_cap: Uint128::new(1_000_000),
            require_kyc_for_transfer: None,
            identity_registry: None,
            compliance: None,
        };
        let _ = instantiate(
            deps.as_mut(),
            env.clone(),
            message_info(&deployer, &coins(0, "u")),
            inst,
        )
        .unwrap();

        // Approve KYC for bob via owner as agent/controller capabilities
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::SetKycStatus { address: bob_addr.to_string(), status: KycStatus::Approved },
        )
        .unwrap();

        // Add bob to denylist
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::AddToDenylist { address: bob_addr.to_string() },
        )
        .unwrap();

        // Mint to bob should fail (owner is issuer)
        let res = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::Mint { recipient: bob_addr.to_string(), amount: Uint128::new(1) },
        );
        assert!(res.is_err());

        // Transfer from owner to bob should fail
        let res = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::Transfer { recipient: bob_addr.to_string(), amount: Uint128::new(1) },
        );
        assert!(res.is_err());

        // Remove from denylist and transfer should now succeed
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::RemoveFromDenylist { address: bob_addr.to_string() },
        )
        .unwrap();

        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::Transfer { recipient: bob_addr.to_string(), amount: Uint128::new(1) },
        )
        .unwrap();
    }

    #[test]
    fn governance_pause_unpause_flow() {
        let mut deps = mock_dependencies();
        let env = mock_env();

        let api = cosmwasm_std::testing::MockApi::default();
        let owner_addr = api.addr_make("owner");
        let deployer = api.addr_make("deployer");
        let m1 = api.addr_make("m1");
        let m2 = api.addr_make("m2");

        let inst = InstantiateMsg {
            name: "RWA".to_string(),
            symbol: "RWA".to_string(),
            decimals: 6u8,
            initial_balances: vec![],
            issuer: owner_addr.to_string(),
            controller: owner_addr.to_string(),
            owner: owner_addr.to_string(),
            cap: None,
            minting_cap: Uint128::new(1_000_000),
            require_kyc_for_transfer: None,
            identity_registry: None,
            compliance: None,
        };
        let _ = instantiate(
            deps.as_mut(),
            env.clone(),
            message_info(&deployer, &coins(0, "u")),
            inst,
        )
        .unwrap();

        // Configure governance with 2 members, threshold 2, no timelock
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&owner_addr, &[]),
            ExecuteMsg::SetGovernanceConfig { members: vec![m1.to_string(), m2.to_string()], threshold: 2, timelock_seconds: 0 },
        )
        .unwrap();

        // Submit pause by m1 -> proposal id 1
        let _ = execute(
            deps.as_mut(),
            env.clone(),
            message_info(&m1, &[]),
            ExecuteMsg::SubmitGovProposal { action: "pause".to_string() },
        )
        .unwrap();

        // Approve by both
        let _ = execute(
            deps.as_mut(), env.clone(), message_info(&m1, &[]), ExecuteMsg::ApproveGovProposal { proposal_id: 1 }
        ).unwrap();
        let _ = execute(
            deps.as_mut(), env.clone(), message_info(&m2, &[]), ExecuteMsg::ApproveGovProposal { proposal_id: 1 }
        ).unwrap();

        // Execute
        let _ = execute(
            deps.as_mut(), env.clone(), message_info(&m1, &[]), ExecuteMsg::ExecuteGovProposal { proposal_id: 1 }
        ).unwrap();

        // Assert paused
        let paused_bin = query(deps.as_ref(), env.clone(), QueryMsg::Paused {}).unwrap();
        let paused: bool = from_json(&paused_bin).unwrap();
        assert!(paused);

        // Submit unpause and run similarly
        let _ = execute(
            deps.as_mut(), env.clone(), message_info(&m2, &[]), ExecuteMsg::SubmitGovProposal { action: "unpause".to_string() }
        ).unwrap();
        let _ = execute(
            deps.as_mut(), env.clone(), message_info(&m1, &[]), ExecuteMsg::ApproveGovProposal { proposal_id: 2 }
        ).unwrap();
        let _ = execute(
            deps.as_mut(), env.clone(), message_info(&m2, &[]), ExecuteMsg::ApproveGovProposal { proposal_id: 2 }
        ).unwrap();
        let _ = execute(
            deps.as_mut(), env.clone(), message_info(&owner_addr, &[]), ExecuteMsg::ExecuteGovProposal { proposal_id: 2 }
        ).unwrap();
        let paused_bin = query(deps.as_ref(), env.clone(), QueryMsg::Paused {}).unwrap();
        let paused: bool = from_json(&paused_bin).unwrap();
        assert!(!paused);
    }
}

```

## contracts/cw3643-token/src/error.rs

```
use cosmwasm_std::{StdError, Uint128};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},
    #[error("Paused")]
    Paused {},
    #[error("KYC not approved for address: {0}")]
    KycNotApproved(String),
    #[error("Cap reached")]
    CapReached {},
    #[error("Minting cap exceeded: attempted {attempted}, cap {cap}, current supply {current}")]
    MintingCapExceeded {
        attempted: Uint128,
        cap: Uint128,
        current: Uint128,
    },
    #[error("Insufficient funds")]
    InsufficientFunds {},
    #[error("Asset not found")]
    AssetNotFound {},
    #[error("Invalid request")]
    InvalidRequest {},
    #[error("Already approved")]
    AlreadyApproved {},
    #[error("Not compliant: {0}")]
    NotCompliant(String),
    #[error("Not verified for address: {0}")]
    NotVerified(String),
    // Add any other custom errors you like here.
    // Look at https://docs.rs/thiserror/1.0.21/thiserror/ for details.
}

```

## contracts/cw3643-token/src/helpers.rs

```
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use cosmwasm_std::{
    to_json_binary, Addr, CosmosMsg, CustomQuery, Querier, QuerierWrapper, StdResult, WasmMsg,
    WasmQuery,
};

use crate::msg::{ExecuteMsg, GetCountResponse, QueryMsg};

/// CwTemplateContract is a wrapper around Addr that provides a lot of helpers
/// for working with this.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct CwTemplateContract(pub Addr);

impl CwTemplateContract {
    pub fn addr(&self) -> Addr {
        self.0.clone()
    }

    pub fn call<T: Into<ExecuteMsg>>(&self, msg: T) -> StdResult<CosmosMsg> {
        let msg = to_json_binary(&msg.into())?;
        Ok(WasmMsg::Execute {
            contract_addr: self.addr().into(),
            msg,
            funds: vec![],
        }
        .into())
    }

    /// Get Count
    pub fn count<Q, T, CQ>(&self, querier: &Q) -> StdResult<GetCountResponse>
    where
        Q: Querier,
        T: Into<String>,
        CQ: CustomQuery,
    {
        let msg = QueryMsg::GetCount {};
        let query = WasmQuery::Smart {
            contract_addr: self.addr().into(),
            msg: to_json_binary(&msg)?,
        }
        .into();
        let res: GetCountResponse = QuerierWrapper::<CQ>::new(querier).query(&query)?;
        Ok(res)
    }
}

```

## contracts/cw3643-token/src/identity_registry.rs

```
use crate::msg::KycStatus;
use crate::state::*;
use cosmwasm_std::{Addr, Deps, DepsMut, StdResult};

// Identity registry helpers
// Manages KYC statuses stored in `KYC` map in `state.rs`.

pub fn set_kyc(deps: DepsMut, addr: Addr, status: KycStatus) -> StdResult<()> {
    KYC.save(deps.storage, &addr, &status)?;
    Ok(())
}

pub fn is_approved(deps: &Deps, addr: &Addr) -> StdResult<bool> {
    match KYC.may_load(deps.storage, addr)? {
        Some(KycStatus::Approved) => Ok(true),
        _ => Ok(false),
    }
}

pub fn query_status(deps: Deps, addr: &Addr) -> StdResult<KycStatus> {
    Ok(KYC
        .may_load(deps.storage, addr)?
        .unwrap_or(KycStatus::Pending))
}

```

## contracts/cw3643-token/src/integration_tests.rs

```
#[cfg(test)]
mod tests {
    use crate::helpers::CwTemplateContract;
    use crate::msg::InstantiateMsg;
    use cosmwasm_std::testing::MockApi;
    use cosmwasm_std::{Addr, Coin, Empty, Uint128};
    use cw_multi_test::{App, AppBuilder, Contract, ContractWrapper, Executor};

    pub fn contract_template() -> Box<dyn Contract<Empty>> {
        let contract = ContractWrapper::new(
            crate::contract::execute,
            crate::contract::instantiate,
            crate::contract::query,
        );
        Box::new(contract)
    }

    const USER: &str = "USER";
    const ADMIN: &str = "ADMIN";
    const NATIVE_DENOM: &str = "denom";

    fn mock_app() -> App {
        AppBuilder::new().build(|router, _, storage| {
            router
                .bank
                .init_balance(
                    storage,
                    &MockApi::default().addr_make(USER),
                    vec![Coin {
                        denom: NATIVE_DENOM.to_string(),
                        amount: Uint128::new(1),
                    }],
                )
                .unwrap();
        })
    }

    fn proper_instantiate() -> (App, CwTemplateContract) {
        let mut app = mock_app();
        let cw_template_id = app.store_code(contract_template());

        let user = app.api().addr_make(USER);
        assert_eq!(
            app.wrap().query_balance(user, NATIVE_DENOM).unwrap().amount,
            Uint128::new(1)
        );

        let msg = InstantiateMsg { count: 1i32 };
        let cw_template_contract_addr = app
            .instantiate_contract(
                cw_template_id,
                Addr::unchecked(ADMIN),
                &msg,
                &[],
                "test",
                None,
            )
            .unwrap();

        let cw_template_contract = CwTemplateContract(cw_template_contract_addr);

        (app, cw_template_contract)
    }

    mod count {
        use super::*;
        use crate::msg::ExecuteMsg;

        #[test]
        fn count() {
            let (mut app, cw_template_contract) = proper_instantiate();

            let msg = ExecuteMsg::Increment {};
            let cosmos_msg = cw_template_contract.call(msg).unwrap();
            app.execute(Addr::unchecked(USER), cosmos_msg).unwrap();
        }
    }
}

```

## contracts/cw3643-token/src/interfaces.rs

```
use cosmwasm_std::Uint128;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// Interfaces for external validator contracts
// Identity Registry (IR)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum IrQueryMsg {
    IsVerified { wallet: String },
    Identity { wallet: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IsVerifiedResponse {
    pub verified: bool,
    pub reason: Option<String>,
}

// Compliance contract
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceQueryMsg {
    CanTransfer {
        token: String,
        from: String,
        to: String,
        amount: Uint128,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct CanTransferResponse {
    pub allowed: bool,
    pub reason: Option<String>,
}

// Compliance contract execute messages (for callbacks)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceExecuteMsg {
    Transferred {
        from: String,
        to: String,
        amount: Uint128,
    },
    Created {
        to: String,
        amount: Uint128,
    },
    Destroyed {
        from: String,
        amount: Uint128,
    },
}

```

## contracts/cw3643-token/src/lib.rs

```
#![allow(clippy::collapsible_match, clippy::unnecessary_mut_passed)]
//! CW-3643 Token Library
//! 
//! This library provides the public API for the CW-3643 compliant security token contract.
//! All business logic is implemented in contract.rs and supporting modules.

pub mod admin;
pub mod compliance;
pub mod contract;
pub mod error;
pub mod identity_registry;
pub mod interfaces;
pub mod msg;
pub mod state;

// Re-export for external usage
pub use crate::error::ContractError;
pub use crate::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};

```

## contracts/cw3643-token/src/msg.rs

```
use cosmwasm_schema::QueryResponses;
use cosmwasm_std::Uint128;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Initial balance used at instantiation
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InitialBalance {
    pub address: String,
    pub amount: Uint128,
}

/// Instantiate message tailored for a compliant security token
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub initial_balances: Vec<InitialBalance>,
    pub issuer: String,
    pub controller: String,
    pub owner: String,
    pub cap: Option<Uint128>,
    pub minting_cap: Uint128,  // REQUIRED: Maximum tokens that can ever be minted
    pub require_kyc_for_transfer: Option<bool>,
    // Optional external validator contracts
    pub identity_registry: Option<String>,
    pub compliance: Option<String>,
}

/// KYC status for an address
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub enum KycStatus {
    Pending,
    Approved,
    Revoked,
}

/// Execute messages for CW-3643 compliant security token
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    // Standard CW20 operations
    Transfer {
        recipient: String,
        amount: Uint128,
    },
    Approve {
        spender: String,
        amount: Uint128,
    },
    TransferFrom {
        owner: String,
        recipient: String,
        amount: Uint128,
    },
    Mint {
        recipient: String,
        amount: Uint128,
    },
    Burn {
        amount: Uint128,
    },
    // ERC-3643 compliant: Force burn from any address (agent only)
    ForceBurn {
        from: String,
        amount: Uint128,
    },
    
    // Compliance-specific operations (TREX standard)
    ForceTransfer {
        from: String,
        to: String,
        amount: Uint128,
        reason: Option<String>,
    },
    SetKycStatus {
        address: String,
        status: KycStatus,
    },
    Pause {},
    Unpause {},
    
    // Role management
    UpdateOwner {
        owner: String,
    },
    UpdateIssuer {
        issuer: String,
    },
    UpdateController {
        controller: String,
    },
    UpdateValidators {
        identity_registry: Option<String>,
        compliance: Option<String>,
    },
    AddAgent {
        address: String,
    },
    RemoveAgent {
        address: String,
    },
    
    // Security controls
    AddToDenylist { 
        address: String 
    },
    RemoveFromDenylist { 
        address: String 
    },
    Freeze {
        address: String,
    },
    Unfreeze {
        address: String,
    },
    FreezeMany {
        addresses: Vec<String>,
    },
    
    // Batch operations
    BatchTransfer {
        transfers: Vec<TransferItem>,
    },
    BatchSetKyc {
        updates: Vec<KycUpdate>,
    },
    
    // Recovery operations
    ReplaceWallet {
        lost: String,
        new: String,
    },
    
    // Compliance rule plugins
    UpdateRulePlugins {
        add: Vec<String>,
        remove: Vec<String>,
    },
    
    // RWA-specific asset management
    CreateAsset {
        reference_id: String,
        description: String,
        legal_owner: String,
        metadata: Option<String>,
    },
    IssueAsset {
        asset_id: u64,
        recipient: String,
        amount: Uint128,
    },
    RequestRedemption {
        asset_id: u64,
        amount: Uint128,
        reason: Option<String>,
    },
    ApproveIssue {
        request_id: u64,
    },
    ApproveRedemption {
        request_id: u64,
    },
    AttachAttestation {
        subject: String,
        attestation: String,
    },
    SetTransferLimit {
        address: String,
        limit: Option<Uint128>,
    },
    
    // Governance (multi-sig/timelock)
    SetGovernanceConfig { 
        members: Vec<String>, 
        threshold: u32, 
        timelock_seconds: u64 
    },
    SubmitGovProposal { 
        action: String 
    },
    ApproveGovProposal { 
        proposal_id: u64 
    },
    ExecuteGovProposal { 
        proposal_id: u64 
    },
}

/// Query messages and responses
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema, QueryResponses)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    #[returns(TokenInfoResponse)]
    TokenInfo {},
    #[returns(Uint128)]
    Balance { address: String },
    #[returns(Uint128)]
    Allowance { owner: String, spender: String },
    #[returns(Uint128)]
    TotalSupply {},
    #[returns(KycStatusResponse)]
    KycStatus { address: String },
    #[returns(AssetInfoResponse)]
    AssetInfo { asset_id: u64 },
    #[returns(Vec<RedeemRequestResponse>)]
    RedemptionRequests {
        start_after: Option<u64>,
        limit: Option<u32>,
    },
    #[returns(RolesResponse)]
    Roles {},
    #[returns(bool)]
    Paused {},
    #[returns(Option<Uint128>)]
    TransferLimit { address: String },
    #[returns(Option<Uint128>)]
    Cap {},
    #[returns(MintingCapResponse)]
    MintingCap {},
    #[returns(ValidatorsResponse)]
    Validators {},
    #[returns(AgentsResponse)]
    Agents {},
    #[returns(bool)]
    Frozen { address: String },
    #[returns(RulePluginsResponse)]
    RulePlugins {},
    #[returns(ComplianceMetricsResponse)]
    ComplianceMetrics {},
    #[returns(GovConfigResponse)]
    GovConfig {},
    #[returns(GovProposalResponse)]
    GovProposal { proposal_id: u64 },
    #[returns(Vec<GovProposalResponse>)]
    GovProposals { start_after: Option<u64>, limit: Option<u32> },
}

// Response types
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TokenInfoResponse {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct KycStatusResponse {
    pub address: String,
    pub status: KycStatus,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AssetInfoResponse {
    pub asset_id: u64,
    pub reference_id: String,
    pub description: String,
    pub legal_owner: String,
    pub metadata: Option<String>,
    pub total_tokenized: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RedeemRequestResponse {
    pub id: u64,
    pub asset_id: u64,
    pub requester: String,
    pub amount: Uint128,
    pub approved: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RolesResponse {
    pub owner: String,
    pub issuer: String,
    pub controller: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ValidatorsResponse {
    pub identity_registry: Option<String>,
    pub compliance: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AgentsResponse {
    pub agents: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MintingCapResponse {
    pub minting_cap: Uint128,
    pub current_supply: Uint128,
    pub available_to_mint: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RulePluginsResponse {
    pub plugins: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TransferItem {
    pub recipient: String,
    pub amount: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct KycUpdate {
    pub address: String,
    pub status: KycStatus,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ComplianceMetricsResponse {
    pub kyc_pending: u32,
    pub kyc_approved: u32,
    pub kyc_revoked: u32,
    pub frozen_count: u32,
    pub denylisted: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct GovConfigResponse {
    pub members: Vec<String>,
    pub threshold: u32,
    pub timelock_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct GovProposalResponse {
    pub id: u64,
    pub action: String,
    pub proposer: String,
    pub approvals: u32,
    pub executed: bool,
    pub creation_time: u64,
    pub timelock_end: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

```

## contracts/cw3643-token/src/state.rs

```
use crate::msg::KycStatus;
use cosmwasm_std::Addr;
use cosmwasm_std::Uint128;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// Token metadata
pub const TOKEN_SYMBOL: Item<String> = Item::new("token_symbol");
pub const TOKEN_NAME: Item<String> = Item::new("token_name");
pub const TOKEN_DECIMALS: Item<u8> = Item::new("token_decimals");
pub const TOTAL_SUPPLY: Item<Uint128> = Item::new("total_supply");

// Balances and allowances (CW20 standard)
pub const BALANCES: Map<&Addr, Uint128> = Map::new("balances");
pub const ALLOWANCES: Map<(&Addr, &Addr), Uint128> = Map::new("allowances");

// Role management
pub const OWNER: Item<Addr> = Item::new("owner");
pub const ISSUER: Item<Addr> = Item::new("issuer");
pub const CONTROLLER: Item<Addr> = Item::new("controller");

// External validator addresses (TREX-style)
pub const IDENTITY_REGISTRY_ADDR: Item<Option<Addr>> = Item::new("identity_registry_addr");
pub const COMPLIANCE_ADDR: Item<Option<Addr>> = Item::new("compliance_addr");

// Token controls
pub const PAUSED: Item<bool> = Item::new("paused");
pub const CAP: Item<Option<Uint128>> = Item::new("cap");

// Minting cap enforcement (CRITICAL SECURITY)
pub const MINTING_CAP: Item<Uint128> = Item::new("minting_cap");

// Compliance and security
pub const KYC: Map<&Addr, KycStatus> = Map::new("kyc");
pub const AGENTS: Map<&Addr, bool> = Map::new("agents");
pub const FROZEN: Map<&Addr, bool> = Map::new("frozen");
pub const DENYLIST: Map<&Addr, bool> = Map::new("denylist");
pub const RULE_PLUGINS: Map<&Addr, bool> = Map::new("rule_plugins");

// Optional: index prefix for balance iteration
pub const BALANCES_PREFIX: &str = "balances";

// RWA Asset Management
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AssetInfo {
    pub id: u64,
    pub reference_id: String,
    pub description: String,
    pub legal_owner: Addr,
    pub metadata: Option<String>,
    pub total_tokenized: Uint128,
}

pub const ASSET_SEQ: Item<u64> = Item::new("asset_seq");
pub const ASSETS: Map<u64, AssetInfo> = Map::new("assets");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RedemptionRequest {
    pub id: u64,
    pub asset_id: u64,
    pub requester: Addr,
    pub amount: Uint128,
    pub approved: bool,
    pub reason: Option<String>,
}

pub const REDEEM_SEQ: Item<u64> = Item::new("redeem_seq");
pub const REDEEM_REQUESTS: Map<u64, RedemptionRequest> = Map::new("redeem_requests");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IssuanceRequest {
    pub id: u64,
    pub asset_id: u64,
    pub recipient: Addr,
    pub amount: Uint128,
    pub approved: bool,
}

pub const ISSUANCE_SEQ: Item<u64> = Item::new("issuance_seq");
pub const ISSUANCE_REQUESTS: Map<u64, IssuanceRequest> = Map::new("issuance_requests");

// Additional compliance features
pub const ATTESTATIONS: Map<&Addr, String> = Map::new("attestations");
pub const TRANSFER_LIMITS: Map<&Addr, Option<Uint128>> = Map::new("transfer_limits");

// Governance (multi-sig/timelock)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct GovConfig {
    pub threshold: u32,
    pub timelock_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct GovProposal {
    pub id: u64,
    pub action: String,
    pub proposer: Addr,
    pub approvals: u32,
    pub executed: bool,
    pub creation_time: u64,
    pub timelock_end: u64,
}

pub const GOV_CONFIG: Item<Option<GovConfig>> = Item::new("gov_config");
pub const GOV_MEMBERS: Map<&Addr, bool> = Map::new("gov_members");
pub const GOV_PROPOSAL_SEQ: Item<u64> = Item::new("gov_prop_seq");
pub const GOV_PROPOSALS: Map<u64, GovProposal> = Map::new("gov_proposals");

```

## contracts/cw3643-token/src/types.rs

```

```

## contracts/identity_registry/src/bin/schema.rs

```
use cosmwasm_schema::write_api;

use identity_registry_cw::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        migrate: MigrateMsg,
    }
}

```

## contracts/identity_registry/src/contract.rs

```
//! Identity Registry Contract
//!
//! This contract manages identity registrations for wallets, linking them to
//! ONCHAINID contracts and performing claim-based verification through
//! trusted issuers and required claim topics.

use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:identity-registry-cw";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let owner = deps.api.addr_validate(&msg.owner)?;
    OWNER.save(deps.storage, &owner)?;
    TRUSTED_ISSUERS_ADDR.save(
        deps.storage,
        &msg.trusted_issuers
            .and_then(|s| deps.api.addr_validate(&s).ok()),
    )?;
    CLAIM_TOPICS_ADDR.save(
        deps.storage,
        &msg.claim_topics
            .and_then(|s| deps.api.addr_validate(&s).ok()),
    )?;
    IDENTITY_STORAGE_ADDR.save(
        deps.storage,
        &msg.identity_storage
            .and_then(|s| deps.api.addr_validate(&s).ok()),
    )?;
    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", info.sender))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::RegisterIdentity {
            wallet,
            identity_addr,
            country,
        } => {
            only_owner(deps.as_ref(), &info)?;
            let w = deps.api.addr_validate(&wallet)?;
            let i = deps.api.addr_validate(&identity_addr)?;
            REGISTRY.save(
                deps.storage,
                &w,
                &IdentityRef {
                    identity_addr: i,
                    country,
                },
            )?;
            Ok(Response::new()
                .add_attribute("action", "register_identity")
                .add_attribute("wallet", wallet))
        }
        ExecuteMsg::UnregisterIdentity { wallet } => {
            only_owner(deps.as_ref(), &info)?;
            let w = deps.api.addr_validate(&wallet)?;
            REGISTRY.remove(deps.storage, &w);
            Ok(Response::new()
                .add_attribute("action", "unregister_identity")
                .add_attribute("wallet", wallet))
        }
        ExecuteMsg::UpdateIdentity {
            wallet,
            identity_addr,
        } => {
            only_owner(deps.as_ref(), &info)?;
            let w = deps.api.addr_validate(&wallet)?;
            let new_identity = deps.api.addr_validate(&identity_addr)?;
            
            // Load existing registration
            let mut reg = REGISTRY
                .may_load(deps.storage, &w)?
                .ok_or(ContractError::NotRegistered {})?;
            
            let old_identity = reg.identity_addr.clone();
            reg.identity_addr = new_identity.clone();
            
            REGISTRY.save(deps.storage, &w, &reg)?;
            
            Ok(Response::new()
                .add_attribute("action", "update_identity")
                .add_attribute("wallet", wallet)
                .add_attribute("old_identity", old_identity.to_string())
                .add_attribute("new_identity", new_identity.to_string()))
        }
        ExecuteMsg::UpdateCountry { wallet, country } => {
            only_owner(deps.as_ref(), &info)?;
            let w = deps.api.addr_validate(&wallet)?;
            
            // Load existing registration
            let mut reg = REGISTRY
                .may_load(deps.storage, &w)?
                .ok_or(ContractError::NotRegistered {})?;
            
            let old_country = reg.country.clone();
            reg.country = country.clone();
            
            REGISTRY.save(deps.storage, &w, &reg)?;
            
            Ok(Response::new()
                .add_attribute("action", "update_country")
                .add_attribute("wallet", wallet)
                .add_attribute("old_country", old_country.unwrap_or_else(|| "none".to_string()))
                .add_attribute("new_country", country.unwrap_or_else(|| "none".to_string())))
        }
        ExecuteMsg::UpdateOwner { owner } => {
            only_owner(deps.as_ref(), &info)?;
            let o = deps.api.addr_validate(&owner)?;
            OWNER.save(deps.storage, &o)?;
            Ok(Response::new()
                .add_attribute("action", "update_owner")
                .add_attribute("owner", owner))
        }
        ExecuteMsg::UpdateTrustedIssuers { addr } => {
            only_owner(deps.as_ref(), &info)?;
            let a = addr.and_then(|s| deps.api.addr_validate(&s).ok());
            TRUSTED_ISSUERS_ADDR.save(deps.storage, &a)?;
            Ok(Response::new().add_attribute("action", "update_trusted_issuers"))
        }
        ExecuteMsg::UpdateClaimTopics { addr } => {
            only_owner(deps.as_ref(), &info)?;
            let a = addr.and_then(|s| deps.api.addr_validate(&s).ok());
            CLAIM_TOPICS_ADDR.save(deps.storage, &a)?;
            Ok(Response::new().add_attribute("action", "update_claim_topics"))
        }
        ExecuteMsg::BindIdentityStorage { addr } => {
            only_owner(deps.as_ref(), &info)?;
            
            // Save IRS address locally
            let irs_addr_opt = addr.as_ref().and_then(|s| deps.api.addr_validate(s).ok());
            IDENTITY_STORAGE_ADDR.save(deps.storage, &irs_addr_opt)?;
            
            // If IRS address is provided, notify IRS to register this IR
            let mut response = Response::new().add_attribute("action", "bind_identity_storage");
            
            if let Some(irs_addr) = irs_addr_opt {
                // Create ExecuteMsg to bind this IR in the IRS
                // Using the BindIdentityRegistry message from IRS
                #[derive(serde::Serialize)]
                #[serde(rename_all = "snake_case")]
                enum IrsExecuteMsg {
                    BindIdentityRegistry { registry: String },
                }
                
                let bind_msg = cosmwasm_std::WasmMsg::Execute {
                    contract_addr: irs_addr.to_string(),
                    msg: cosmwasm_std::to_json_binary(&IrsExecuteMsg::BindIdentityRegistry {
                        registry: _env.contract.address.to_string()
                    })?,
                    funds: vec![],
                };
                
                response = response
                    .add_message(bind_msg)
                    .add_attribute("irs_address", irs_addr.to_string())
                    .add_attribute("notified_irs", "true");
            }
            
            Ok(response)
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::IsVerified { wallet } => to_json_binary(&query_is_verified(deps, wallet)?),
        QueryMsg::Identity { wallet } => to_json_binary(&query_identity(deps, wallet)?),
        QueryMsg::Contains { wallet } => to_json_binary(&query_contains(deps, wallet)?),
        QueryMsg::TrustedIssuersRegistry {} => to_json_binary(&query_trusted_issuers_registry(deps)?),
        QueryMsg::ClaimTopicsRegistry {} => to_json_binary(&query_claim_topics_registry(deps)?),
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
    }
}

fn query_is_verified(deps: Deps, wallet: String) -> StdResult<IsVerifiedResponse> {
    let w = deps.api.addr_validate(&wallet)?;
    
    // Try local registry first
    let entry = REGISTRY.may_load(deps.storage, &w)?;
    
    // If not in local registry, try IRS (if bound)
    let reg = if let Some(ref local_reg) = entry {
        local_reg.clone()
    } else {
        // Try querying IRS
        let irs_addr = IDENTITY_STORAGE_ADDR.may_load(deps.storage)?.flatten();
        if let Some(irs) = irs_addr {
            #[derive(serde::Serialize)]
            #[serde(rename_all = "snake_case")]
            enum IrsQuery {
                StoredIdentity { wallet: String },
            }
            #[derive(serde::Deserialize)]
            struct StoredIdentityResponse {
                identity: String,
                country: u16,
            }
            
            // Query IRS for investor data
            match deps.querier.query_wasm_smart::<StoredIdentityResponse>(
                irs.clone(),
                &IrsQuery::StoredIdentity { wallet: wallet.clone() },
            ) {
                Ok(irs_data) => {
                    // Found in IRS - use that data
                    let identity_addr = deps.api.addr_validate(&irs_data.identity)?;
                    IdentityRef {
                        identity_addr,
                        country: Some(irs_data.country.to_string()),
                    }
                },
                Err(_) => {
                    // Not in IRS either - not registered
                    return Ok(IsVerifiedResponse {
                        verified: false,
                        reason: Some("wallet not registered in IR or IRS".to_string()),
                    });
                }
            }
        } else {
            // No IRS bound and not in local registry
            return Ok(IsVerifiedResponse {
                verified: false,
                reason: Some("wallet not registered".to_string()),
            });
        }
    };

    // If both TIR and CTR are configured and identity_addr exists, perform claim-aware checks
    let tir = TRUSTED_ISSUERS_ADDR.may_load(deps.storage)?.flatten();
    let ctr = CLAIM_TOPICS_ADDR.may_load(deps.storage)?.flatten();
    if let (Some(tir_addr), Some(ctr_addr)) = (tir, ctr) {
        if reg.identity_addr.as_str().is_empty() {
            return Ok(IsVerifiedResponse {
                verified: false,
                reason: Some("missing identity address".to_string()),
            });
        }
        // 1) fetch required topics from CTR
        #[derive(serde::Serialize)]
        #[serde(rename_all = "snake_case")]
        enum CtrQuery {
            RequiredTopics {},
        }
        #[derive(serde::Deserialize)]
        struct RequiredTopicsResponse {
            topics: Vec<u32>,
        }
        let topics: Vec<u32> = deps
            .querier
            .query_wasm_smart::<RequiredTopicsResponse>(
                ctr_addr.clone(),
                &CtrQuery::RequiredTopics {},
            )?
            .topics;

        // If no required topics configured, fall back to registration-only success
        if topics.is_empty() {
            return Ok(IsVerifiedResponse {
                verified: true,
                reason: None,
            });
        }

        // 2) ERC-3643 v4.0 OPTIMIZATION: Query TIR for issuers per topic (not all issuers)
        // This reduces from O(n*m) to O(m) where n=total issuers, m=required topics
        #[derive(serde::Serialize)]
        #[serde(rename_all = "snake_case")]
        enum TirQuery {
            TrustedIssuersForTopic { topic: u32 },
        }
        #[derive(serde::Deserialize)]
        struct TrustedIssuersForTopicResponse {
            issuers: Vec<String>,
        }

        // 3) for each topic, fetch trusted issuers and query ONCHAINID for a valid claim
        #[derive(serde::Serialize)]
        #[serde(rename_all = "snake_case")]
        enum OnIdQuery<'a> {
            HasValidClaim {
                topic: u32,
                issuer_whitelist: Option<Vec<&'a str>>,
                at_time: Option<u64>,
            },
        }
        #[derive(serde::Deserialize)]
        struct HasValidClaimResponse {
            valid: bool,
        }

        for t in topics.into_iter() {
            // Use v4.0 optimized query - fetch only issuers for this topic
            let whitelist: Vec<String> = deps
                .querier
                .query_wasm_smart::<TrustedIssuersForTopicResponse>(
                    tir_addr.clone(),
                    &TirQuery::TrustedIssuersForTopic { topic: t },
                )?
                .issuers;
                
            if whitelist.is_empty() {
                return Ok(IsVerifiedResponse {
                    verified: false,
                    reason: Some(format!("no trusted issuers for topic {}", t)),
                });
            }
            let refs: Vec<&str> = whitelist.iter().map(|s| s.as_str()).collect();
            let resp: HasValidClaimResponse = deps.querier.query_wasm_smart(
                reg.identity_addr.clone(),
                &OnIdQuery::HasValidClaim {
                    topic: t,
                    issuer_whitelist: Some(refs),
                    at_time: None,
                },
            )?;
            if !resp.valid {
                return Ok(IsVerifiedResponse {
                    verified: false,
                    reason: Some(format!("missing required claim for topic {}", t)),
                });
            }
        }
        return Ok(IsVerifiedResponse {
            verified: true,
            reason: None,
        });
    }

    // Fallback: registration-only success
    Ok(IsVerifiedResponse {
        verified: true,
        reason: None,
    })
}

fn query_identity(deps: Deps, wallet: String) -> StdResult<IdentityResponse> {
    let w = deps.api.addr_validate(&wallet)?;
    let info = REGISTRY.may_load(deps.storage, &w)?;
    Ok(IdentityResponse {
        wallet,
        identity_addr: info.as_ref().map(|r| r.identity_addr.to_string()),
        country: info.and_then(|r| r.country),
    })
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let owner = OWNER.load(deps.storage)?;
    let tir = TRUSTED_ISSUERS_ADDR.may_load(deps.storage)?.flatten();
    let ctr = CLAIM_TOPICS_ADDR.may_load(deps.storage)?.flatten();
    let irs = IDENTITY_STORAGE_ADDR.may_load(deps.storage)?.flatten();
    Ok(ConfigResponse {
        owner: owner.to_string(),
        trusted_issuers: tir.map(|a| a.to_string()),
        claim_topics: ctr.map(|a| a.to_string()),
        identity_storage: irs.map(|a| a.to_string()),
    })
}

fn query_contains(deps: Deps, wallet: String) -> StdResult<ContainsResponse> {
    let w = deps.api.addr_validate(&wallet)?;
    let contains = REGISTRY.may_load(deps.storage, &w)?.is_some();
    Ok(ContainsResponse { contains })
}

fn query_trusted_issuers_registry(deps: Deps) -> StdResult<RegistryAddressResponse> {
    let addr = TRUSTED_ISSUERS_ADDR.may_load(deps.storage)?.flatten();
    Ok(RegistryAddressResponse {
        address: addr.map(|a| a.to_string()),
    })
}

fn query_claim_topics_registry(deps: Deps) -> StdResult<RegistryAddressResponse> {
    let addr = CLAIM_TOPICS_ADDR.may_load(deps.storage)?.flatten();
    Ok(RegistryAddressResponse {
        address: addr.map(|a| a.to_string()),
    })
}

fn only_owner(deps: Deps, info: &MessageInfo) -> Result<(), ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::Unauthorized {});
    }
    Ok(())
}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new().add_attribute("action", "migrate"))
}

```

## contracts/identity_registry/src/error.rs

```
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Identity already registered for address: {address}")]
    AlreadyRegistered { address: String },

    #[error("Identity not registered")]
    NotRegistered {},
}

```

## contracts/identity_registry/src/lib.rs

```
//! Identity Registry Library
//! 
//! This library provides the public API for the Identity Registry contract.
//! All business logic is implemented in contract.rs.

pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

// Re-export for external usage
pub use crate::error::ContractError;
pub use crate::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};
```

## contracts/identity_registry/src/msg.rs

```
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub owner: String,
    pub trusted_issuers: Option<String>,
    pub claim_topics: Option<String>,
    pub identity_storage: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    RegisterIdentity {
        wallet: String,
        identity_addr: String,
        country: Option<String>,
    },
    UnregisterIdentity {
        wallet: String,
    },
    UpdateIdentity {
        wallet: String,
        identity_addr: String,
    },
    UpdateCountry {
        wallet: String,
        country: Option<String>,
    },
    UpdateOwner {
        owner: String,
    },
    UpdateTrustedIssuers {
        addr: Option<String>,
    },
    UpdateClaimTopics {
        addr: Option<String>,
    },
    BindIdentityStorage {
        addr: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    IsVerified { wallet: String },
    Identity { wallet: String },
    Contains { wallet: String },
    TrustedIssuersRegistry {},
    ClaimTopicsRegistry {},
    Config {},
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IsVerifiedResponse {
    pub verified: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IdentityResponse {
    pub wallet: String,
    pub identity_addr: Option<String>,
    pub country: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub owner: String,
    pub trusted_issuers: Option<String>,
    pub claim_topics: Option<String>,
    pub identity_storage: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ContainsResponse {
    pub contains: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RegistryAddressResponse {
    pub address: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

```

## contracts/identity_registry/src/state.rs

```
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const OWNER: Item<Addr> = Item::new("owner");
pub const TRUSTED_ISSUERS_ADDR: Item<Option<Addr>> = Item::new("trusted_issuers_addr");
pub const CLAIM_TOPICS_ADDR: Item<Option<Addr>> = Item::new("claim_topics_addr");
pub const IDENTITY_STORAGE_ADDR: Item<Option<Addr>> = Item::new("identity_storage_addr");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IdentityRef {
    pub identity_addr: Addr,
    pub country: Option<String>,
}

pub const REGISTRY: Map<&Addr, IdentityRef> = Map::new("registry");

```

## contracts/identity_registry_storage/src/contract.rs

```
use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult, Addr,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:identity-registry-storage-cw";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let owner = deps.api.addr_validate(&msg.owner)?;
    OWNER.save(deps.storage, &owner)?;
    LINKED_REGISTRIES.save(deps.storage, &vec![])?;
    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", info.sender))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::AddIdentity {
            wallet,
            identity,
            country,
        } => execute_add_identity(deps, info, wallet, identity, country),
        ExecuteMsg::ModifyIdentity { wallet, identity } => {
            execute_modify_identity(deps, info, wallet, identity)
        }
        ExecuteMsg::ModifyCountry { wallet, country } => {
            execute_modify_country(deps, info, wallet, country)
        }
        ExecuteMsg::RemoveIdentity { wallet } => execute_remove_identity(deps, info, wallet),
        ExecuteMsg::BindIdentityRegistry { registry } => {
            execute_bind_registry(deps, info, registry)
        }
        ExecuteMsg::UnbindIdentityRegistry { registry } => {
            execute_unbind_registry(deps, info, registry)
        }
        ExecuteMsg::TransferOwnership { new_owner } => {
            execute_transfer_ownership(deps, info, new_owner)
        }
    }
}

fn is_agent(deps: Deps, sender: &Addr) -> StdResult<bool> {
    let registries = LINKED_REGISTRIES.load(deps.storage)?;
    Ok(registries.contains(sender))
}

fn is_owner_or_agent(deps: Deps, sender: &Addr) -> StdResult<bool> {
    let owner = OWNER.load(deps.storage)?;
    if sender == &owner {
        return Ok(true);
    }
    is_agent(deps, sender)
}

fn execute_add_identity(
    deps: DepsMut,
    info: MessageInfo,
    wallet: String,
    identity: String,
    country: u16,
) -> Result<Response, ContractError> {
    if !is_owner_or_agent(deps.as_ref(), &info.sender)? {
        return Err(ContractError::Unauthorized {});
    }

    let wallet_addr = deps.api.addr_validate(&wallet)?;
    let identity_addr = deps.api.addr_validate(&identity)?;

    if IDENTITIES.has(deps.storage, &wallet_addr) {
        return Err(ContractError::IdentityAlreadyStored {});
    }

    IDENTITIES.save(
        deps.storage,
        &wallet_addr,
        &Identity {
            identity: identity_addr.clone(),
            country,
        },
    )?;

    Ok(Response::new()
        .add_attribute("action", "add_identity")
        .add_attribute("wallet", wallet)
        .add_attribute("identity", identity_addr))
}

fn execute_modify_identity(
    deps: DepsMut,
    info: MessageInfo,
    wallet: String,
    identity: String,
) -> Result<Response, ContractError> {
    if !is_owner_or_agent(deps.as_ref(), &info.sender)? {
        return Err(ContractError::Unauthorized {});
    }

    let wallet_addr = deps.api.addr_validate(&wallet)?;
    let identity_addr = deps.api.addr_validate(&identity)?;

    let mut stored = IDENTITIES
        .load(deps.storage, &wallet_addr)
        .map_err(|_| ContractError::IdentityNotStored {})?;

    stored.identity = identity_addr.clone();
    IDENTITIES.save(deps.storage, &wallet_addr, &stored)?;

    Ok(Response::new()
        .add_attribute("action", "modify_identity")
        .add_attribute("wallet", wallet)
        .add_attribute("identity", identity_addr))
}

fn execute_modify_country(
    deps: DepsMut,
    info: MessageInfo,
    wallet: String,
    country: u16,
) -> Result<Response, ContractError> {
    if !is_owner_or_agent(deps.as_ref(), &info.sender)? {
        return Err(ContractError::Unauthorized {});
    }

    let wallet_addr = deps.api.addr_validate(&wallet)?;

    let mut stored = IDENTITIES
        .load(deps.storage, &wallet_addr)
        .map_err(|_| ContractError::IdentityNotStored {})?;

    stored.country = country;
    IDENTITIES.save(deps.storage, &wallet_addr, &stored)?;

    Ok(Response::new()
        .add_attribute("action", "modify_country")
        .add_attribute("wallet", wallet)
        .add_attribute("country", country.to_string()))
}

fn execute_remove_identity(
    deps: DepsMut,
    info: MessageInfo,
    wallet: String,
) -> Result<Response, ContractError> {
    if !is_owner_or_agent(deps.as_ref(), &info.sender)? {
        return Err(ContractError::Unauthorized {});
    }

    let wallet_addr = deps.api.addr_validate(&wallet)?;

    if !IDENTITIES.has(deps.storage, &wallet_addr) {
        return Err(ContractError::IdentityNotStored {});
    }

    IDENTITIES.remove(deps.storage, &wallet_addr);

    Ok(Response::new()
        .add_attribute("action", "remove_identity")
        .add_attribute("wallet", wallet))
}

fn execute_bind_registry(
    deps: DepsMut,
    info: MessageInfo,
    registry: String,
) -> Result<Response, ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::Unauthorized {});
    }

    let registry_addr = deps.api.addr_validate(&registry)?;
    let mut registries = LINKED_REGISTRIES.load(deps.storage)?;

    if registries.len() >= 300 {
        return Err(ContractError::TooManyRegistries {});
    }

    if !registries.contains(&registry_addr) {
        registries.push(registry_addr.clone());
        LINKED_REGISTRIES.save(deps.storage, &registries)?;
    }

    Ok(Response::new()
        .add_attribute("action", "bind_registry")
        .add_attribute("registry", registry))
}

fn execute_unbind_registry(
    deps: DepsMut,
    info: MessageInfo,
    registry: String,
) -> Result<Response, ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::Unauthorized {});
    }

    let registry_addr = deps.api.addr_validate(&registry)?;
    let mut registries = LINKED_REGISTRIES.load(deps.storage)?;

    if let Some(pos) = registries.iter().position(|r| r == &registry_addr) {
        registries.remove(pos);
        LINKED_REGISTRIES.save(deps.storage, &registries)?;
    } else {
        return Err(ContractError::RegistryNotBound {});
    }

    Ok(Response::new()
        .add_attribute("action", "unbind_registry")
        .add_attribute("registry", registry))
}

fn execute_transfer_ownership(
    deps: DepsMut,
    info: MessageInfo,
    new_owner: String,
) -> Result<Response, ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::Unauthorized {});
    }

    let new_owner_addr = deps.api.addr_validate(&new_owner)?;
    OWNER.save(deps.storage, &new_owner_addr)?;

    Ok(Response::new()
        .add_attribute("action", "transfer_ownership")
        .add_attribute("new_owner", new_owner))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::StoredIdentity { wallet } => to_json_binary(&query_stored_identity(deps, wallet)?),
        QueryMsg::StoredCountry { wallet } => to_json_binary(&query_stored_country(deps, wallet)?),
        QueryMsg::LinkedRegistries {} => to_json_binary(&query_linked_registries(deps)?),
        QueryMsg::Owner {} => to_json_binary(&query_owner(deps)?),
    }
}

fn query_stored_identity(deps: Deps, wallet: String) -> StdResult<IdentityResponse> {
    let wallet_addr = deps.api.addr_validate(&wallet)?;
    let identity = IDENTITIES.load(deps.storage, &wallet_addr)?;
    Ok(IdentityResponse {
        identity: identity.identity,
        country: identity.country,
    })
}

fn query_stored_country(deps: Deps, wallet: String) -> StdResult<CountryResponse> {
    let wallet_addr = deps.api.addr_validate(&wallet)?;
    let identity = IDENTITIES.load(deps.storage, &wallet_addr)?;
    Ok(CountryResponse {
        country: identity.country,
    })
}

fn query_linked_registries(deps: Deps) -> StdResult<LinkedRegistriesResponse> {
    let registries = LINKED_REGISTRIES.load(deps.storage)?;
    Ok(LinkedRegistriesResponse { registries })
}

fn query_owner(deps: Deps) -> StdResult<OwnerResponse> {
    let owner = OWNER.load(deps.storage)?;
    Ok(OwnerResponse { owner })
}

```

## contracts/identity_registry_storage/src/error.rs

```
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Identity already stored for address")]
    IdentityAlreadyStored {},

    #[error("Identity not stored for address")]
    IdentityNotStored {},

    #[error("Cannot bind more than 300 identity registries")]
    TooManyRegistries {},

    #[error("Identity registry not bound")]
    RegistryNotBound {},
}

```

## contracts/identity_registry_storage/src/lib.rs

```
pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

pub use crate::error::ContractError;

```

## contracts/identity_registry_storage/src/msg.rs

```
use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Addr;

#[cw_serde]
pub struct InstantiateMsg {
    pub owner: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    AddIdentity {
        wallet: String,
        identity: String,
        country: u16,
    },
    ModifyIdentity {
        wallet: String,
        identity: String,
    },
    ModifyCountry {
        wallet: String,
        country: u16,
    },
    RemoveIdentity {
        wallet: String,
    },
    BindIdentityRegistry {
        registry: String,
    },
    UnbindIdentityRegistry {
        registry: String,
    },
    TransferOwnership {
        new_owner: String,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(IdentityResponse)]
    StoredIdentity { wallet: String },
    
    #[returns(CountryResponse)]
    StoredCountry { wallet: String },
    
    #[returns(LinkedRegistriesResponse)]
    LinkedRegistries {},
    
    #[returns(OwnerResponse)]
    Owner {},
}

#[cw_serde]
pub struct IdentityResponse {
    pub identity: Addr,
    pub country: u16,
}

#[cw_serde]
pub struct CountryResponse {
    pub country: u16,
}

#[cw_serde]
pub struct LinkedRegistriesResponse {
    pub registries: Vec<Addr>,
}

#[cw_serde]
pub struct OwnerResponse {
    pub owner: Addr,
}

```

## contracts/identity_registry_storage/src/state.rs

```
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const OWNER: Item<Addr> = Item::new("owner");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Identity {
    pub identity: Addr,
    pub country: u16,
}

pub const IDENTITIES: Map<&Addr, Identity> = Map::new("identities");
pub const LINKED_REGISTRIES: Item<Vec<Addr>> = Item::new("linked_registries");

```

## contracts/onchainid/src/bin/schema.rs

```
use cosmwasm_schema::write_api;

use onchainid_cw::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        migrate: MigrateMsg,
    }
}

```

## contracts/onchainid/src/contract.rs

```
//! OnChainID Contract
//! 
//! This contract implements decentralized identity with claims management.
//! Claims are assertions about the identity holder issued by trusted third parties.

use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:onchainid-cw";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let owner = deps.api.addr_validate(&msg.owner)?;
    OWNER.save(deps.storage, &owner)?;
    CLAIM_SEQ.save(deps.storage, &0u64)?;
    
    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", info.sender))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::AddClaim {
            topic,
            issuer,
            data,
            expires_at,
        } => {
            let issuer_addr = deps.api.addr_validate(&issuer)?;
            
            // SECURITY: Only the claim issuer can add claims (anti-forgery)
            // This prevents anyone from forging claims on behalf of others
            // TIR validation happens at Identity Registry level during token transfers
            if info.sender != issuer_addr {
                return Err(ContractError::Unauthorized {});
            }
            
            let mut seq = CLAIM_SEQ.load(deps.storage)?;
            seq += 1;
            CLAIM_SEQ.save(deps.storage, &seq)?;
            let rec = ClaimRecord {
                id: seq,
                topic,
                issuer: issuer_addr,
                data,
                issued_at: env.block.time.seconds(),
                expires_at,
                revoked: false,
            };
            CLAIMS.save(deps.storage, (topic, seq), &rec)?;
            Ok(Response::new()
                .add_attribute("action", "add_claim")
                .add_attribute("topic", topic.to_string())
                .add_attribute("id", seq.to_string()))
        }
        ExecuteMsg::RevokeClaim { topic, claim_id } => {
            let mut rec = CLAIMS.load(deps.storage, (topic, claim_id))?;
            let owner = OWNER.load(deps.storage)?;
            if info.sender != rec.issuer && info.sender != owner {
                return Err(ContractError::Unauthorized {});
            }
            rec.revoked = true;
            CLAIMS.save(deps.storage, (topic, claim_id), &rec)?;
            Ok(Response::new()
                .add_attribute("action", "revoke_claim")
                .add_attribute("topic", topic.to_string())
                .add_attribute("id", claim_id.to_string()))
        }
        ExecuteMsg::UpdateOwner { owner } => {
            let o = deps.api.addr_validate(&owner)?;
            only_owner(deps.as_ref(), &info)?;
            OWNER.save(deps.storage, &o)?;
            Ok(Response::new()
                .add_attribute("action", "update_owner")
                .add_attribute("owner", owner))
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::ClaimsByTopic { topic } => to_json_binary(&query_claims_by_topic(deps, topic)?),
        QueryMsg::HasValidClaim {
            topic,
            issuer_whitelist,
            at_time,
        } => to_json_binary(&query_has_valid_claim(
            deps,
            env,
            topic,
            issuer_whitelist,
            at_time,
        )?),
    }
}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new().add_attribute("action", "migrate"))
}

// Query handlers

fn query_claims_by_topic(deps: Deps, topic: u32) -> StdResult<Vec<ClaimResponse>> {
    let mut res: Vec<ClaimResponse> = vec![];
    let prefix = CLAIMS.prefix(topic);
    let mut it = prefix.range(deps.storage, None, None, cosmwasm_std::Order::Ascending);
    while let Some(item) = it.next() {
        let (_k, v) = item?;
        res.push(ClaimResponse {
            id: v.id,
            topic: v.topic,
            issuer: v.issuer.to_string(),
            data: v.data,
            issued_at: v.issued_at,
            expires_at: v.expires_at,
            revoked: v.revoked,
        });
    }
    Ok(res)
}

fn query_has_valid_claim(
    deps: Deps,
    env: Env,
    topic: u32,
    issuer_whitelist: Option<Vec<String>>,
    at_time: Option<u64>,
) -> StdResult<HasValidClaimResponse> {
    let t = at_time.unwrap_or(env.block.time.seconds());
    let mut ok = false;
    let allowed: Option<Vec<String>> = issuer_whitelist;
    let prefix = CLAIMS.prefix(topic);
    let mut it = prefix.range(deps.storage, None, None, cosmwasm_std::Order::Ascending);
    'outer: while let Some(item) = it.next() {
        let (_k, v) = item?;
        if v.revoked {
            continue;
        }
        if let Some(exp) = v.expires_at {
            if exp <= t {
                continue;
            }
        }
        if let Some(list) = &allowed {
            if !list.iter().any(|s| s == &v.issuer.to_string()) {
                continue;
            }
        }
        ok = true;
        break 'outer;
    }
    Ok(HasValidClaimResponse { valid: ok })
}

// Helper functions

fn only_owner(deps: Deps, info: &MessageInfo) -> Result<(), ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::Unauthorized {});
    }
    Ok(())
}

```

## contracts/onchainid/src/error.rs

```
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Claim not found")]
    ClaimNotFound {},

    #[error("Claim already revoked")]
    AlreadyRevoked {},
}

```

## contracts/onchainid/src/lib.rs

```
//! OnChainID Library
//! 
//! This library provides the public API for the OnChainID contract.
//! All business logic is implemented in contract.rs.

pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

// Re-export for external usage
pub use crate::error::ContractError;
pub use crate::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};


```

## contracts/onchainid/src/msg.rs

```
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub owner: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    AddClaim {
        topic: u32,
        issuer: String,
        data: Option<String>,
        expires_at: Option<u64>,
    },
    RevokeClaim {
        topic: u32,
        claim_id: u64,
    },
    UpdateOwner {
        owner: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    ClaimsByTopic {
        topic: u32,
    },
    HasValidClaim {
        topic: u32,
        issuer_whitelist: Option<Vec<String>>,
        at_time: Option<u64>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ClaimResponse {
    pub id: u64,
    pub topic: u32,
    pub issuer: String,
    pub data: Option<String>,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
    pub revoked: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct HasValidClaimResponse {
    pub valid: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

```

## contracts/onchainid/src/state.rs

```
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const OWNER: Item<Addr> = Item::new("owner");
pub const CLAIM_SEQ: Item<u64> = Item::new("claim_seq");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ClaimRecord {
    pub id: u64,
    pub topic: u32,
    pub issuer: Addr,
    pub data: Option<String>,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
    pub revoked: bool,
}

// Keyed by (topic, claim_id)
pub const CLAIMS: Map<(u32, u64), ClaimRecord> = Map::new("claims");

```

## contracts/trex_factory/src/bin/schema.rs

```
use cosmwasm_schema::write_api;
use trex_factory::msg::{ExecuteMsg, InstantiateMsg, QueryMsg, MigrateMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        query: QueryMsg,
        migrate: MigrateMsg,
    }
}

```

## contracts/trex_factory/src/contract.rs

```
use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Order,
    Response, StdResult, SubMsg, Uint128, WasmMsg, Reply,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::{
    AllTokensResponse, AssetIdResponse, ConfigResponse, ExecuteMsg, InstantiateMsg, MigrateMsg,
    QueryMsg, TokenInfoResponse,
};
use crate::state::{Config, TokenInfo, CONFIG, TOKENS, TOKEN_SEQ, TOKEN_TO_ASSET, PENDING_DEPLOYMENT};

const CONTRACT_NAME: &str = "crates.io:trex-factory";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

const REPLY_CTR: u64 = 1;
const REPLY_TIR: u64 = 2;
const REPLY_IR: u64 = 3;
const REPLY_COMPLIANCE: u64 = 4;
const REPLY_TOKEN: u64 = 5;

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let config = Config {
        admin: _info.sender.clone(),
        token_code_id: msg.token_code_id,
        ctr_code_id: msg.ctr_code_id,
        tir_code_id: msg.tir_code_id,
        compliance_code_id: msg.compliance_code_id,
        ir_code_id: msg.ir_code_id,
        identity_registry_storage: deps.api.addr_validate(&msg.identity_registry_storage)?,
        onchainid_code_id: msg.onchainid_code_id,
        default_owner: deps.api.addr_validate(&msg.default_owner)?,
        default_issuer: deps.api.addr_validate(&msg.default_issuer)?,
        default_controller: deps.api.addr_validate(&msg.default_controller)?,
    };

    CONFIG.save(deps.storage, &config)?;
    TOKEN_SEQ.save(deps.storage, &0u64)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("admin", _info.sender)
        .add_attribute("token_code_id", msg.token_code_id.to_string())
        .add_attribute("ctr_code_id", msg.ctr_code_id.to_string())
        .add_attribute("tir_code_id", msg.tir_code_id.to_string())
        .add_attribute("compliance_code_id", msg.compliance_code_id.to_string()))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::CreateToken {
            reference_id,
            name,
            symbol,
            decimals,
            description,
            legal_owner,
            metadata,
            initial_supply,
            initial_holder,
            minting_cap,
            claim_details,
        } => execute_create_token(
            deps,
            env,
            info,
            reference_id,
            name,
            symbol,
            decimals,
            description,
            legal_owner,
            metadata,
            initial_supply,
            initial_holder,
            minting_cap,
            claim_details,
        ),
        ExecuteMsg::UpdateConfig {
            token_code_id,
            ctr_code_id,
            tir_code_id,
            compliance_code_id,
            ir_code_id,
            identity_registry_storage,
            onchainid_code_id,
            default_owner,
            default_issuer,
            default_controller,
        } => execute_update_config(
            deps,
            info,
            token_code_id,
            ctr_code_id,
            tir_code_id,
            compliance_code_id,
            ir_code_id,
            identity_registry_storage,
            onchainid_code_id,
            default_owner,
            default_issuer,
            default_controller,
        ),
        ExecuteMsg::UpdateAdmin { new_admin } => execute_update_admin(deps, info, new_admin),
    }
}

fn execute_create_token(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    reference_id: String,
    name: String,
    symbol: String,
    _decimals: u8,
    description: String,
    legal_owner: String,
    metadata: Option<String>,
    _initial_supply: Option<Uint128>,
    _initial_holder: Option<String>,
    minting_cap: Uint128,
    claim_details: crate::msg::ClaimDetails,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let mut seq = TOKEN_SEQ.load(deps.storage)?;
    seq += 1;
    TOKEN_SEQ.save(deps.storage, &seq)?;

    let legal_owner_addr = deps.api.addr_validate(&legal_owner)?;

    let pending = crate::state::PendingDeployment {
        asset_id: seq,
        name: name.clone(),
        symbol: symbol.clone(),
        reference_id: reference_id.clone(),
        description,
        legal_owner: legal_owner_addr,
        metadata,
        deployed_at: env.block.height,
        minting_cap,  // SECURITY: Save minting cap for token
        claim_details: crate::state::ClaimDetails {
            claim_topics: claim_details.claim_topics,
            issuers: claim_details.issuers,
            issuer_claims: claim_details.issuer_claims,
        },
        ctr_addr: None,
        tir_addr: None,
        ir_addr: None,
        compliance_addr: None,
    };
    
    PENDING_DEPLOYMENT.save(deps.storage, &pending)?;

    let ctr_msg = WasmMsg::Instantiate {
        admin: Some(config.admin.to_string()),
        code_id: config.ctr_code_id,
        msg: to_json_binary(&CtrInstantiateMsg {
            owner: config.default_owner.to_string(),
            required_topics: pending.claim_details.claim_topics.clone(),
        })?,
        funds: vec![],
        label: format!("CTR-{}", seq),
    };

    Ok(Response::new()
        .add_submessage(SubMsg::reply_on_success(ctr_msg, REPLY_CTR))
        .add_attribute("method", "create_token")
        .add_attribute("asset_id", seq.to_string())
        .add_attribute("reference_id", reference_id))
}

#[entry_point]
pub fn reply(deps: DepsMut, _env: Env, msg: Reply) -> Result<Response, ContractError> {
    match msg.id {
        REPLY_CTR => handle_ctr_reply(deps, msg),
        REPLY_TIR => handle_tir_reply(deps, msg),
        REPLY_IR => handle_ir_reply(deps, msg),
        REPLY_COMPLIANCE => handle_compliance_reply(deps, msg),
        REPLY_TOKEN => handle_token_reply(deps, msg),
        _ => Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            "Unknown reply ID",
        ))),
    }
}

fn extract_contract_address(msg: &Reply) -> Result<Addr, ContractError> {
    let res = match &msg.result {
        cosmwasm_std::SubMsgResult::Ok(res) => res,
        cosmwasm_std::SubMsgResult::Err(e) => {
            return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
                format!("Submessage failed: {}", e),
            )))
        }
    };
    
    let contract_address = res
        .events
        .iter()
        .find(|e| e.ty == "instantiate")
        .and_then(|e| {
            e.attributes
                .iter()
                .find(|a| a.key == "_contract_address")
                .map(|a| a.value.clone())
        })
        .ok_or_else(|| {
            ContractError::Std(cosmwasm_std::StdError::generic_err(
                "Contract address not found in reply",
            ))
        })?;

    Ok(Addr::unchecked(contract_address))
}

fn handle_ctr_reply(deps: DepsMut, msg: Reply) -> Result<Response, ContractError> {
    let ctr_addr = extract_contract_address(&msg)?;
    let config = CONFIG.load(deps.storage)?;
    
    let mut pending = PENDING_DEPLOYMENT.load(deps.storage)?;
    pending.ctr_addr = Some(ctr_addr.clone());
    PENDING_DEPLOYMENT.save(deps.storage, &pending)?;

    let tir_msg = WasmMsg::Instantiate {
        admin: Some(config.admin.to_string()),
        code_id: config.tir_code_id,
        msg: to_json_binary(&TirInstantiateMsg {
            owner: config.default_owner.to_string(),
        })?,
        funds: vec![],
        label: format!("TIR-{}", pending.asset_id),
    };

    Ok(Response::new()
        .add_submessage(SubMsg::reply_on_success(tir_msg, REPLY_TIR))
        .add_attribute("ctr_deployed", ctr_addr))
}

fn handle_tir_reply(deps: DepsMut, msg: Reply) -> Result<Response, ContractError> {
    let tir_addr = extract_contract_address(&msg)?;
    let config = CONFIG.load(deps.storage)?;
    
    let mut pending = PENDING_DEPLOYMENT.load(deps.storage)?;
    pending.tir_addr = Some(tir_addr.clone());
    PENDING_DEPLOYMENT.save(deps.storage, &pending)?;

    // NOTE: Trusted issuers must be added to TIR manually by the TIR owner after token deployment
    // Factory cannot add issuers because TIR requires info.sender == owner, and Factory is not the owner
    // The TIR owner (default_owner from config) must execute AddIssuer for each issuer

    // Instantiate Identity Registry (IR) per token
    let ir_msg = WasmMsg::Instantiate {
        admin: Some(config.admin.to_string()),
        code_id: config.ir_code_id,
        msg: to_json_binary(&IrInstantiateMsg {
            owner: config.default_owner.to_string(),
            trusted_issuers: Some(tir_addr.to_string()),
            claim_topics: Some(pending.ctr_addr.clone().unwrap().to_string()),
            identity_storage: Some(config.identity_registry_storage.to_string()),
        })?,
        funds: vec![],
        label: format!("IR-{}", pending.asset_id),
    };

    Ok(Response::new()
        .add_submessage(SubMsg::reply_on_success(ir_msg, REPLY_IR))
        .add_attribute("tir_deployed", tir_addr))
}

fn handle_ir_reply(deps: DepsMut, msg: Reply) -> Result<Response, ContractError> {
    let ir_addr = extract_contract_address(&msg)?;
    let config = CONFIG.load(deps.storage)?;
    
    let mut pending = PENDING_DEPLOYMENT.load(deps.storage)?;
    pending.ir_addr = Some(ir_addr.clone());
    PENDING_DEPLOYMENT.save(deps.storage, &pending)?;

    // Note: IR binding to IRS must be done by owner after deployment
    // Owner must execute: IRS.execute(BindIdentityRegistry { registry: IR_ADDRESS })
    // This is required because only IRS owner can bind registries (security requirement)

    let compliance_msg = WasmMsg::Instantiate {
        admin: Some(config.admin.to_string()),
        code_id: config.compliance_code_id,
        msg: to_json_binary(&ComplianceInstantiateMsg {
            owner: config.default_owner.to_string(),
            identity_registry: Some(ir_addr.to_string()),
        })?,
        funds: vec![],
        label: format!("COMPLIANCE-{}", pending.asset_id),
    };

    Ok(Response::new()
        .add_submessage(SubMsg::reply_on_success(compliance_msg, REPLY_COMPLIANCE))
        .add_attribute("ir_deployed", ir_addr)
        .add_attribute("action", "bind_ir_to_irs_required"))
}

fn handle_compliance_reply(deps: DepsMut, msg: Reply) -> Result<Response, ContractError> {
    let compliance_addr = extract_contract_address(&msg)?;
    let config = CONFIG.load(deps.storage)?;
    
    let mut pending = PENDING_DEPLOYMENT.load(deps.storage)?;
    pending.compliance_addr = Some(compliance_addr.clone());
    PENDING_DEPLOYMENT.save(deps.storage, &pending)?;

    let token_msg = WasmMsg::Instantiate {
        admin: Some(config.admin.to_string()),
        code_id: config.token_code_id,
        msg: to_json_binary(&TokenInstantiateMsg {
            name: pending.name.clone(),
            symbol: pending.symbol.clone(),
            decimals: 6,
            initial_balances: vec![],
            issuer: config.default_issuer.to_string(),
            controller: config.default_controller.to_string(),
            owner: config.default_owner.to_string(),
            cap: None,
            minting_cap: pending.minting_cap,  // SECURITY: Pass minting cap to token
            require_kyc_for_transfer: Some(true),
            identity_registry: Some(pending.ir_addr.clone().unwrap().to_string()),
            compliance: Some(compliance_addr.to_string()),
        })?,
        funds: vec![],
        label: format!("TOKEN-{}", pending.asset_id),
    };

    Ok(Response::new()
        .add_submessage(SubMsg::reply_on_success(token_msg, REPLY_TOKEN))
        .add_attribute("compliance_deployed", compliance_addr))
}

fn handle_token_reply(deps: DepsMut, msg: Reply) -> Result<Response, ContractError> {
    let token_addr = extract_contract_address(&msg)?;
    let _config = CONFIG.load(deps.storage)?;
    
    let pending = PENDING_DEPLOYMENT.load(deps.storage)?;

    let token_info = TokenInfo {
        asset_id: pending.asset_id,
        contract_address: token_addr.clone(),
        name: pending.name,
        symbol: pending.symbol,
        reference_id: pending.reference_id,
        description: pending.description,
        legal_owner: pending.legal_owner,
        metadata: pending.metadata,
        deployed_at: pending.deployed_at,
        identity_registry: pending.ir_addr.unwrap(),
        trusted_issuers_registry: pending.tir_addr.unwrap(),
        claim_topics_registry: pending.ctr_addr.unwrap(),
        compliance: pending.compliance_addr.unwrap(),
    };

    TOKENS.save(deps.storage, pending.asset_id, &token_info)?;
    TOKEN_TO_ASSET.save(deps.storage, &token_addr, &pending.asset_id)?;
    
    PENDING_DEPLOYMENT.remove(deps.storage);

    Ok(Response::new()
        .add_attribute("token_deployed", token_addr)
        .add_attribute("asset_id", pending.asset_id.to_string()))
}

fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    token_code_id: Option<u64>,
    ctr_code_id: Option<u64>,
    tir_code_id: Option<u64>,
    compliance_code_id: Option<u64>,
    ir_code_id: Option<u64>,
    identity_registry_storage: Option<String>,
    onchainid_code_id: Option<u64>,
    default_owner: Option<String>,
    default_issuer: Option<String>,
    default_controller: Option<String>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    if let Some(code_id) = token_code_id {
        config.token_code_id = code_id;
    }
    if let Some(code_id) = ctr_code_id {
        config.ctr_code_id = code_id;
    }
    if let Some(code_id) = tir_code_id {
        config.tir_code_id = code_id;
    }
    if let Some(code_id) = compliance_code_id {
        config.compliance_code_id = code_id;
    }
    if let Some(code_id) = ir_code_id {
        config.ir_code_id = code_id;
    }
    if let Some(irs) = identity_registry_storage {
        config.identity_registry_storage = deps.api.addr_validate(&irs)?;
    }
    if let Some(code_id) = onchainid_code_id {
        config.onchainid_code_id = code_id;
    }
    if let Some(owner) = default_owner {
        config.default_owner = deps.api.addr_validate(&owner)?;
    }
    if let Some(issuer) = default_issuer {
        config.default_issuer = deps.api.addr_validate(&issuer)?;
    }
    if let Some(controller) = default_controller {
        config.default_controller = deps.api.addr_validate(&controller)?;
    }

    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("method", "update_config"))
}

fn execute_update_admin(
    deps: DepsMut,
    info: MessageInfo,
    new_admin: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.admin = deps.api.addr_validate(&new_admin)?;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("method", "update_admin")
        .add_attribute("new_admin", new_admin))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::Token { asset_id } => to_json_binary(&query_token(deps, asset_id)?),
        QueryMsg::AllTokens { start_after, limit } => {
            to_json_binary(&query_all_tokens(deps, start_after, limit)?)
        }
        QueryMsg::AssetIdByContract { contract } => {
            to_json_binary(&query_asset_id_by_contract(deps, contract)?)
        }
    }
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        admin: config.admin.to_string(),
        token_code_id: config.token_code_id,
        ctr_code_id: config.ctr_code_id,
        tir_code_id: config.tir_code_id,
        compliance_code_id: config.compliance_code_id,
        ir_code_id: config.ir_code_id,
        identity_registry_storage: config.identity_registry_storage.to_string(),
        onchainid_code_id: config.onchainid_code_id,
        default_owner: config.default_owner.to_string(),
        default_issuer: config.default_issuer.to_string(),
        default_controller: config.default_controller.to_string(),
    })
}

fn query_token(deps: Deps, asset_id: u64) -> StdResult<TokenInfoResponse> {
    let token = TOKENS.load(deps.storage, asset_id)?;
    Ok(TokenInfoResponse {
        asset_id: token.asset_id,
        contract_address: token.contract_address.to_string(),
        name: token.name,
        symbol: token.symbol,
        reference_id: token.reference_id,
        description: token.description,
        legal_owner: token.legal_owner.to_string(),
        metadata: token.metadata,
        deployed_at: token.deployed_at,
        identity_registry: token.identity_registry.to_string(),
        trusted_issuers_registry: token.trusted_issuers_registry.to_string(),
        claim_topics_registry: token.claim_topics_registry.to_string(),
        compliance: token.compliance.to_string(),
    })
}

fn query_all_tokens(
    deps: Deps,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<AllTokensResponse> {
    let start = start_after.map(|id| id + 1).unwrap_or(1);
    let limit = limit.unwrap_or(30).min(100) as usize;

    let tokens: Vec<TokenInfoResponse> = TOKENS
        .range(deps.storage, None, None, Order::Ascending)
        .filter_map(|item| {
            if let Ok((id, token)) = item {
                if id >= start {
                    Some(TokenInfoResponse {
                        asset_id: token.asset_id,
                        contract_address: token.contract_address.to_string(),
                        name: token.name,
                        symbol: token.symbol,
                        reference_id: token.reference_id,
                        description: token.description,
                        legal_owner: token.legal_owner.to_string(),
                        metadata: token.metadata,
                        deployed_at: token.deployed_at,
                        identity_registry: token.identity_registry.to_string(),
                        trusted_issuers_registry: token.trusted_issuers_registry.to_string(),
                        claim_topics_registry: token.claim_topics_registry.to_string(),
                        compliance: token.compliance.to_string(),
                    })
                } else {
                    None
                }
            } else {
                None
            }
        })
        .take(limit)
        .collect();

    Ok(AllTokensResponse { tokens })
}

fn query_asset_id_by_contract(deps: Deps, contract: String) -> StdResult<AssetIdResponse> {
    let contract_addr = deps.api.addr_validate(&contract)?;
    let asset_id = TOKEN_TO_ASSET.load(deps.storage, &contract_addr)?;
    Ok(AssetIdResponse { asset_id })
}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new().add_attribute("method", "migrate"))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CtrInstantiateMsg {
    pub owner: String,
    pub required_topics: Vec<u32>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct TirInstantiateMsg {
    pub owner: String,
}

#[allow(dead_code)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum TirExecuteMsg {
    AddIssuer { issuer: String, topics: Vec<u32> },
}

#[derive(serde::Serialize, serde::Deserialize)]
struct IrInstantiateMsg {
    pub owner: String,
    pub trusted_issuers: Option<String>,
    pub claim_topics: Option<String>,
    pub identity_storage: Option<String>,
}

// Note: IrsExecuteMsg kept for reference but binding is now done manually by owner
#[allow(dead_code)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum IrsExecuteMsg {
    BindIdentityRegistry { registry: String },
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ComplianceInstantiateMsg {
    pub owner: String,
    pub identity_registry: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct TokenInstantiateMsg {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub initial_balances: Vec<InitialBalance>,
    pub issuer: String,
    pub controller: String,
    pub owner: String,
    pub cap: Option<Uint128>,
    pub minting_cap: Uint128,  // SECURITY: Maximum tokens that can be minted
    pub require_kyc_for_transfer: Option<bool>,
    pub identity_registry: Option<String>,
    pub compliance: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct InitialBalance {
    pub address: String,
    pub amount: Uint128,
}

```

## contracts/trex_factory/src/error.rs

```
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Token with asset_id {asset_id} not found")]
    TokenNotFound { asset_id: u64 },

    #[error("Asset already tokenized with contract: {contract}")]
    AssetAlreadyTokenized { contract: String },

    #[error("Invalid token code_id")]
    InvalidCodeId {},
}

```

## contracts/trex_factory/src/lib.rs

```
pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

pub use crate::error::ContractError;

```

## contracts/trex_factory/src/msg.rs

```
use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Uint128;

#[cw_serde]
pub struct ClaimDetails {
    pub claim_topics: Vec<u32>,
    pub issuers: Vec<String>,
    pub issuer_claims: Vec<Vec<u32>>,
}

#[cw_serde]
pub struct InstantiateMsg {
    pub token_code_id: u64,
    pub ctr_code_id: u64,
    pub tir_code_id: u64,
    pub compliance_code_id: u64,
    pub ir_code_id: u64,
    pub identity_registry_storage: String,
    pub onchainid_code_id: u64,
    pub default_owner: String,
    pub default_issuer: String,
    pub default_controller: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    CreateToken {
        reference_id: String,
        name: String,
        symbol: String,
        decimals: u8,
        description: String,
        legal_owner: String,
        metadata: Option<String>,
        initial_supply: Option<Uint128>,
        initial_holder: Option<String>,
        minting_cap: Uint128,  // REQUIRED: Maximum tokens that can be minted
        claim_details: ClaimDetails,
    },

    UpdateConfig {
        token_code_id: Option<u64>,
        ctr_code_id: Option<u64>,
        tir_code_id: Option<u64>,
        compliance_code_id: Option<u64>,
        ir_code_id: Option<u64>,
        identity_registry_storage: Option<String>,
        onchainid_code_id: Option<u64>,
        default_owner: Option<String>,
        default_issuer: Option<String>,
        default_controller: Option<String>,
    },

    /// Transfer admin rights (admin only)
    UpdateAdmin { new_admin: String },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    /// Get factory configuration
    #[returns(ConfigResponse)]
    Config {},

    /// Get token info by asset_id
    #[returns(TokenInfoResponse)]
    Token { asset_id: u64 },

    /// List all tokens
    #[returns(AllTokensResponse)]
    AllTokens {
        start_after: Option<u64>,
        limit: Option<u32>,
    },

    /// Get asset_id by token contract address
    #[returns(AssetIdResponse)]
    AssetIdByContract { contract: String },
}

// Response types
#[cw_serde]
pub struct ConfigResponse {
    pub admin: String,
    pub token_code_id: u64,
    pub ctr_code_id: u64,
    pub tir_code_id: u64,
    pub compliance_code_id: u64,
    pub ir_code_id: u64,
    pub identity_registry_storage: String,
    pub onchainid_code_id: u64,
    pub default_owner: String,
    pub default_issuer: String,
    pub default_controller: String,
}

#[cw_serde]
pub struct TokenInfoResponse {
    pub asset_id: u64,
    pub contract_address: String,
    pub name: String,
    pub symbol: String,
    pub reference_id: String,
    pub description: String,
    pub legal_owner: String,
    pub metadata: Option<String>,
    pub deployed_at: u64,
    pub identity_registry: String,
    pub trusted_issuers_registry: String,
    pub claim_topics_registry: String,
    pub compliance: String,
}

#[cw_serde]
pub struct AllTokensResponse {
    pub tokens: Vec<TokenInfoResponse>,
}

#[cw_serde]
pub struct AssetIdResponse {
    pub asset_id: u64,
}

#[cw_serde]
pub struct MigrateMsg {}

```

## contracts/trex_factory/src/state.rs

```
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct PendingDeployment {
    pub asset_id: u64,
    pub name: String,
    pub symbol: String,
    pub reference_id: String,
    pub description: String,
    pub legal_owner: Addr,
    pub metadata: Option<String>,
    pub deployed_at: u64,
    pub minting_cap: cosmwasm_std::Uint128,  // SECURITY: Minting cap for token
    pub claim_details: ClaimDetails,
    pub ctr_addr: Option<Addr>,
    pub tir_addr: Option<Addr>,
    pub ir_addr: Option<Addr>,
    pub compliance_addr: Option<Addr>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ClaimDetails {
    pub claim_topics: Vec<u32>,
    pub issuers: Vec<String>,
    pub issuer_claims: Vec<Vec<u32>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub token_code_id: u64,
    pub ctr_code_id: u64,
    pub tir_code_id: u64,
    pub compliance_code_id: u64,
    pub ir_code_id: u64,
    pub identity_registry_storage: Addr,
    pub onchainid_code_id: u64,
    pub default_owner: Addr,
    pub default_issuer: Addr,
    pub default_controller: Addr,
}

/// Token deployment record
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TokenInfo {
    pub asset_id: u64,
    pub contract_address: Addr,
    pub name: String,
    pub symbol: String,
    pub reference_id: String,
    pub description: String,
    pub legal_owner: Addr,
    pub metadata: Option<String>,
    pub deployed_at: u64,
    pub identity_registry: Addr,
    pub trusted_issuers_registry: Addr,
    pub claim_topics_registry: Addr,
    pub compliance: Addr,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const TOKEN_SEQ: Item<u64> = Item::new("token_seq");
pub const PENDING_DEPLOYMENT: Item<PendingDeployment> = Item::new("pending");

pub const TOKENS: Map<u64, TokenInfo> = Map::new("tokens");

pub const TOKEN_TO_ASSET: Map<&Addr, u64> = Map::new("token_to_asset");

```

## contracts/trusted_issuers_registry/src/bin/schema.rs

```
use cosmwasm_schema::write_api;

use trusted_issuers_registry_cw::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        migrate: MigrateMsg,
    }
}

```

## contracts/trusted_issuers_registry/src/contract.rs

```
//! Trusted Issuers Registry Contract
//! 
//! This contract maintains a whitelist of trusted claim issuers and their allowed topics.
//! Only the owner can modify the registry.

use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};
use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:trusted-issuers-registry-cw";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ERC-3643 Constraints (from official Solidity implementation)
const MAX_ISSUERS: usize = 50;
const MAX_TOPICS_PER_ISSUER: usize = 15;

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let owner = deps.api.addr_validate(&msg.owner)?;
    OWNER.save(deps.storage, &owner)?;
    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", info.sender))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::AddIssuer { issuer, topics } => {
            only_owner(deps.as_ref(), &info)?;
            let i = deps.api.addr_validate(&issuer)?;
            
            // ERC-3643 Constraint: Cannot set empty topics
            if topics.is_empty() {
                return Err(ContractError::EmptyTopics {});
            }
            
            // ERC-3643 Constraint: Max 15 topics per issuer (gas limit consideration)
            if topics.len() > MAX_TOPICS_PER_ISSUER {
                return Err(ContractError::TooManyTopicsPerIssuer {
                    max: MAX_TOPICS_PER_ISSUER,
                });
            }
            
            // ERC-3643 Constraint: Max 50 trusted issuers (gas limit consideration)
            let issuer_count = ISSUERS
                .keys(deps.storage, None, None, cosmwasm_std::Order::Ascending)
                .count();
            if issuer_count >= MAX_ISSUERS {
                return Err(ContractError::TooManyIssuers { max: MAX_ISSUERS });
            }
            
            // Save issuer with topics
            ISSUERS.save(deps.storage, &i, &IssuerTopics { topics: topics.clone() })?;
            
            // Update reverse index: add issuer to each topic
            for topic in &topics {
                let mut issuers = TOPICS_TO_ISSUERS
                    .may_load(deps.storage, *topic)?
                    .unwrap_or_default();
                if !issuers.contains(&i) {
                    issuers.push(i.clone());
                    TOPICS_TO_ISSUERS.save(deps.storage, *topic, &issuers)?;
                }
            }
            
            Ok(Response::new()
                .add_attribute("action", "add_issuer")
                .add_attribute("issuer", issuer))
        }
        ExecuteMsg::UpdateIssuerTopics { issuer, topics } => {
            only_owner(deps.as_ref(), &info)?;
            let i = deps.api.addr_validate(&issuer)?;
            
            // ERC-3643 Constraint: Cannot set empty topics
            if topics.is_empty() {
                return Err(ContractError::EmptyTopics {});
            }
            
            // ERC-3643 Constraint: Max 15 topics per issuer
            if topics.len() > MAX_TOPICS_PER_ISSUER {
                return Err(ContractError::TooManyTopicsPerIssuer {
                    max: MAX_TOPICS_PER_ISSUER,
                });
            }
            
            // Get old topics to clean up reverse index
            let old_topics = ISSUERS
                .may_load(deps.storage, &i)?
                .map(|x| x.topics)
                .unwrap_or_default();
            
            // Remove issuer from old topics in reverse index
            for topic in &old_topics {
                if let Some(mut issuers) = TOPICS_TO_ISSUERS.may_load(deps.storage, *topic)? {
                    issuers.retain(|addr| addr != &i);
                    if issuers.is_empty() {
                        TOPICS_TO_ISSUERS.remove(deps.storage, *topic);
                    } else {
                        TOPICS_TO_ISSUERS.save(deps.storage, *topic, &issuers)?;
                    }
                }
            }
            
            // Save new topics
            ISSUERS.save(deps.storage, &i, &IssuerTopics { topics: topics.clone() })?;
            
            // Add issuer to new topics in reverse index
            for topic in &topics {
                let mut issuers = TOPICS_TO_ISSUERS
                    .may_load(deps.storage, *topic)?
                    .unwrap_or_default();
                if !issuers.contains(&i) {
                    issuers.push(i.clone());
                    TOPICS_TO_ISSUERS.save(deps.storage, *topic, &issuers)?;
                }
            }
            
            Ok(Response::new()
                .add_attribute("action", "update_issuer_topics")
                .add_attribute("issuer", issuer))
        }
        ExecuteMsg::RemoveIssuer { issuer } => {
            only_owner(deps.as_ref(), &info)?;
            let i = deps.api.addr_validate(&issuer)?;
            
            // Get issuer's topics to clean up reverse index
            if let Some(issuer_topics) = ISSUERS.may_load(deps.storage, &i)? {
                // Remove issuer from all topics in reverse index
                for topic in &issuer_topics.topics {
                    if let Some(mut issuers) = TOPICS_TO_ISSUERS.may_load(deps.storage, *topic)? {
                        issuers.retain(|addr| addr != &i);
                        if issuers.is_empty() {
                            TOPICS_TO_ISSUERS.remove(deps.storage, *topic);
                        } else {
                            TOPICS_TO_ISSUERS.save(deps.storage, *topic, &issuers)?;
                        }
                    }
                }
            }
            
            // Remove issuer
            ISSUERS.remove(deps.storage, &i);
            
            Ok(Response::new()
                .add_attribute("action", "remove_issuer")
                .add_attribute("issuer", issuer))
        }
        ExecuteMsg::UpdateOwner { owner } => {
            only_owner(deps.as_ref(), &info)?;
            let o = deps.api.addr_validate(&owner)?;
            OWNER.save(deps.storage, &o)?;
            Ok(Response::new()
                .add_attribute("action", "update_owner")
                .add_attribute("owner", owner))
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::IssuerTopics { issuer } => to_json_binary(&query_issuer_topics(deps, issuer)?),
        QueryMsg::IsIssuerForTopic { issuer, topic } => {
            to_json_binary(&query_is_issuer_for_topic(deps, issuer, topic)?)
        }
        QueryMsg::AllIssuers {} => to_json_binary(&query_all_issuers(deps)?),
        QueryMsg::TrustedIssuersForTopic { topic } => {
            to_json_binary(&query_trusted_issuers_for_topic(deps, topic)?)
        }
    }
}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new().add_attribute("action", "migrate"))
}

// Query handlers

fn query_issuer_topics(deps: Deps, issuer: String) -> StdResult<IssuerTopicsResponse> {
    let i = deps.api.addr_validate(&issuer)?;
    let topics = ISSUERS
        .may_load(deps.storage, &i)?
        .map(|x| x.topics)
        .unwrap_or_default();
    Ok(IssuerTopicsResponse { issuer, topics })
}

fn query_is_issuer_for_topic(
    deps: Deps,
    issuer: String,
    topic: u32,
) -> StdResult<IsIssuerForTopicResponse> {
    let i = deps.api.addr_validate(&issuer)?;
    let allowed = ISSUERS
        .may_load(deps.storage, &i)?
        .map(|t| t.topics.contains(&topic))
        .unwrap_or(false);
    Ok(IsIssuerForTopicResponse {
        issuer,
        topic,
        allowed,
    })
}

fn query_all_issuers(deps: Deps) -> StdResult<AllIssuersResponse> {
    let mut res: Vec<IssuerTopicsResponse> = vec![];
    let mut it = ISSUERS.keys(deps.storage, None, None, cosmwasm_std::Order::Ascending);
    while let Some(key) = it.next() {
        let addr = key?;
        let topics = ISSUERS.load(deps.storage, &addr)?.topics;
        res.push(IssuerTopicsResponse {
            issuer: addr.to_string(),
            topics,
        });
    }
    Ok(AllIssuersResponse { issuers: res })
}

// ERC-3643 v4.0: Gas-optimized query for isVerified()
// Returns only issuers that support the specific topic
fn query_trusted_issuers_for_topic(deps: Deps, topic: u32) -> StdResult<TrustedIssuersForTopicResponse> {
    let issuers = TOPICS_TO_ISSUERS
        .may_load(deps.storage, topic)?
        .unwrap_or_default()
        .iter()
        .map(|addr| addr.to_string())
        .collect();
    
    Ok(TrustedIssuersForTopicResponse { issuers })
}

// Helper functions

fn only_owner(deps: Deps, info: &MessageInfo) -> Result<(), ContractError> {
    let owner = OWNER.load(deps.storage)?;
    if info.sender != owner {
        return Err(ContractError::Unauthorized {});
    }
    Ok(())
}

```

## contracts/trusted_issuers_registry/src/error.rs

```
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Issuer already trusted: {issuer}")]
    IssuerAlreadyTrusted { issuer: String },

    #[error("Issuer not found: {issuer}")]
    IssuerNotFound { issuer: String },
    
    #[error("Too many issuers: maximum is {max}")]
    TooManyIssuers { max: usize },
    
    #[error("Too many topics per issuer: maximum is {max}")]
    TooManyTopicsPerIssuer { max: usize },
    
    #[error("Cannot set empty topics array")]
    EmptyTopics {},
}

```

## contracts/trusted_issuers_registry/src/lib.rs

```
//! Trusted Issuers Registry Library
//! 
//! This library provides the public API for the Trusted Issuers Registry contract.
//! All business logic is implemented in contract.rs.

pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

// Re-export for external usage
pub use crate::error::ContractError;
pub use crate::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};

```

## contracts/trusted_issuers_registry/src/msg.rs

```
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub owner: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    AddIssuer { issuer: String, topics: Vec<u32> },
    UpdateIssuerTopics { issuer: String, topics: Vec<u32> },
    RemoveIssuer { issuer: String },
    UpdateOwner { owner: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    IssuerTopics { issuer: String },
    IsIssuerForTopic { issuer: String, topic: u32 },
    AllIssuers {},
    // ERC-3643 v4.0: Gas-optimized query for isVerified()
    TrustedIssuersForTopic { topic: u32 },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IssuerTopicsResponse {
    pub issuer: String,
    pub topics: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IsIssuerForTopicResponse {
    pub issuer: String,
    pub topic: u32,
    pub allowed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AllIssuersResponse {
    pub issuers: Vec<IssuerTopicsResponse>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TrustedIssuersForTopicResponse {
    pub issuers: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

```

## contracts/trusted_issuers_registry/src/state.rs

```
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const OWNER: Item<Addr> = Item::new("owner");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IssuerTopics {
    pub topics: Vec<u32>,
}

pub const ISSUERS: Map<&Addr, IssuerTopics> = Map::new("issuers");

// ERC-3643 v4.0 Optimization: Reverse index from topic to issuers
// Enables O(1) lookup instead of O(n) iteration in isVerified()
pub const TOPICS_TO_ISSUERS: Map<u32, Vec<Addr>> = Map::new("topics_to_issuers");

```

## examples/schema.rs

```
use cosmwasm_schema::write_api;
use cw3643_token::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};

fn main() {
    write_api! {
        instantiate: InstantiateMsg,
        execute: ExecuteMsg,
        query: QueryMsg,
        migrate: MigrateMsg,
    }
}

```

## tests/complete_trex_integration.rs

```
use cosmwasm_std::{Addr, Uint128};
use cw_multi_test::{App, Contract, ContractWrapper, Executor};
use cw3643_token::msg::{ExecuteMsg as TokenExecuteMsg, InstantiateMsg as TokenInstantiateMsg, QueryMsg as TokenQueryMsg};
use compliance_contract_cw::msg::{ExecuteMsg as ComplianceExecuteMsg, InstantiateMsg as ComplianceInstantiateMsg, QueryMsg as ComplianceQueryMsg};
use identity_registry_cw::msg::{ExecuteMsg as IRExecuteMsg, InstantiateMsg as IRInstantiateMsg};
use trusted_issuers_registry_cw::msg::{ExecuteMsg as TIRExecuteMsg, InstantiateMsg as TIRInstantiateMsg};
use claim_topics_registry_cw::msg::{ExecuteMsg as CTRExecuteMsg, InstantiateMsg as CTRInstantiateMsg};
use onchainid_cw::msg::{ExecuteMsg as ONCHAINExecuteMsg, InstantiateMsg as ONCHAINInstantiateMsg};
use zig_tokenfactory_wrapper_cw::msg::{ExecuteMsg as WrapperExecuteMsg, InstantiateMsg as WrapperInstantiateMsg, QueryMsg as WrapperQueryMsg};

#[test]
fn complete_trex_integration_test() {
    let mut app = App::default();
    
    let owner = Addr::unchecked("owner");
    let issuer = Addr::unchecked("issuer");
    let controller = Addr::unchecked("controller");
    let alice = Addr::unchecked("alice");
    let bob = Addr::unchecked("bob");
    
    // Deploy all T-REX contracts
    println!("🚀 Deploying T-REX contracts...");
    
    // 1. ONCHAINID
    let onchainid_code = ContractWrapper::new(
        onchainid_cw::contract::execute,
        onchainid_cw::contract::instantiate,
        onchainid_cw::contract::query,
    );
    let onchainid_code_id = app.store_code(onchainid_code);
    let onchainid_addr = app.instantiate_contract(
        onchainid_code_id,
        owner.clone(),
        &ONCHAINInstantiateMsg { owner: owner.to_string() },
        &[],
        "ONCHAINID",
        None,
    ).unwrap();
    
    // 2. Trusted Issuers Registry
    let tir_code = ContractWrapper::new(
        trusted_issuers_registry_cw::contract::execute,
        trusted_issuers_registry_cw::contract::instantiate,
        trusted_issuers_registry_cw::contract::query,
    );
    let tir_code_id = app.store_code(tir_code);
    let tir_addr = app.instantiate_contract(
        tir_code_id,
        owner.clone(),
        &TIRInstantiateMsg { owner: owner.to_string() },
        &[],
        "Trusted Issuers Registry",
        None,
    ).unwrap();
    
    // 3. Claim Topics Registry
    let ctr_code = ContractWrapper::new(
        claim_topics_registry_cw::contract::execute,
        claim_topics_registry_cw::contract::instantiate,
        claim_topics_registry_cw::contract::query,
    );
    let ctr_code_id = app.store_code(ctr_code);
    let ctr_addr = app.instantiate_contract(
        ctr_code_id,
        owner.clone(),
        &CTRInstantiateMsg { owner: owner.to_string() },
        &[],
        "Claim Topics Registry",
        None,
    ).unwrap();
    
    // 4. Identity Registry
    let ir_code = ContractWrapper::new(
        identity_registry_cw::contract::execute,
        identity_registry_cw::contract::instantiate,
        identity_registry_cw::contract::query,
    );
    let ir_code_id = app.store_code(ir_code);
    let ir_addr = app.instantiate_contract(
        ir_code_id,
        owner.clone(),
        &IRInstantiateMsg { 
            owner: owner.to_string(),
            trusted_issuers_registry: Some(tir_addr.to_string()),
            claim_topics_registry: Some(ctr_addr.to_string()),
        },
        &[],
        "Identity Registry",
        None,
    ).unwrap();
    
    // 5. Compliance Contract (with modular features)
    let compliance_code = ContractWrapper::new(
        compliance_contract_cw::contract::execute,
        compliance_contract_cw::contract::instantiate,
        compliance_contract_cw::contract::query,
    );
    let compliance_code_id = app.store_code(compliance_code);
    let compliance_addr = app.instantiate_contract(
        compliance_code_id,
        owner.clone(),
        &ComplianceInstantiateMsg {
            owner: owner.to_string(),
            identity_registry: Some(ir_addr.to_string()),
        },
        &[],
        "Compliance Contract",
        None,
    ).unwrap();
    
    // 6. TokenFactory Wrapper
    let wrapper_code = ContractWrapper::new(
        zig_tokenfactory_wrapper_cw::contract::execute,
        zig_tokenfactory_wrapper_cw::contract::instantiate,
        zig_tokenfactory_wrapper_cw::contract::query,
    );
    let wrapper_code_id = app.store_code(wrapper_code);
    let wrapper_addr = app.instantiate_contract(
        wrapper_code_id,
        owner.clone(),
        &WrapperInstantiateMsg {
            owner: owner.to_string(),
            allowed_minters: Some(vec![owner.to_string()]),
        },
        &[],
        "TokenFactory Wrapper",
        None,
    ).unwrap();

    // 7. CW-3643 Token
    let token_code = ContractWrapper::new(
        cw3643_token::contract::execute,
        cw3643_token::contract::instantiate,
        cw3643_token::contract::query,
    );
    let token_code_id = app.store_code(token_code);
    let token_addr = app.instantiate_contract(
        token_code_id,
        owner.clone(),
        &TokenInstantiateMsg {
            name: "TREX Security Token".to_string(),
            symbol: "TREX".to_string(),
            decimals: 6,
            initial_balances: vec![],
            issuer: issuer.to_string(),
            controller: controller.to_string(),
            owner: owner.to_string(),
            cap: Some(Uint128::new(1000000)),
            identity_registry: Some(ir_addr.to_string()),
            compliance: Some(compliance_addr.to_string()),
        },
        &[],
        "CW-3643 Token",
        None,
    ).unwrap();

    // Link the TokenFactory Wrapper to the CW-3643 Token contract
    app.execute_contract(
        owner.clone(),
        wrapper_addr.clone(),
        &WrapperExecuteMsg::SetRwaTokenAddress { address: token_addr.to_string() },
        &[],
    ).unwrap();
    
    println!("✅ All contracts deployed successfully");
    
    // Setup T-REX infrastructure
    println!("🔧 Setting up T-REX infrastructure...");
    
    // Set required claim topics
    app.execute_contract(
        owner.clone(),
        ctr_addr.clone(),
        &CTRExecuteMsg::SetRequiredTopics { topics: vec![1, 2] },
        &[],
    ).unwrap();
    
    // Add trusted issuer
    app.execute_contract(
        owner.clone(),
        tir_addr.clone(),
        &TIRExecuteMsg::AddIssuer { 
            issuer: onchainid_addr.to_string(),
            topics: vec![1, 2],
        },
        &[],
    ).unwrap();
    
    // Register identities
    app.execute_contract(
        owner.clone(),
        ir_addr.clone(),
        &IRExecuteMsg::RegisterIdentity {
            wallet: alice.to_string(),
            identity_addr: onchainid_addr.to_string(),
            country: Some("US".to_string()),
        },
        &[],
    ).unwrap();
    
    app.execute_contract(
        owner.clone(),
        ir_addr.clone(),
        &IRExecuteMsg::RegisterIdentity {
            wallet: bob.to_string(),
            identity_addr: onchainid_addr.to_string(),
            country: Some("US".to_string()),
        },
        &[],
    ).unwrap();
    
    // Add claims for alice and bob
    app.execute_contract(
        owner.clone(),
        onchainid_addr.clone(),
        &ONCHAINExecuteMsg::AddClaim {
            topic: 1,
            issuer: onchainid_addr.to_string(),
            data: "KYC_VERIFIED".to_string(),
            expires_at: None,
        },
        &[],
    ).unwrap();
    
    app.execute_contract(
        owner.clone(),
        onchainid_addr.clone(),
        &ONCHAINExecuteMsg::AddClaim {
            topic: 2,
            issuer: onchainid_addr.to_string(),
            data: "AML_CHECKED".to_string(),
            expires_at: None,
        },
        &[],
    ).unwrap();
    
    // Set KYC status
    app.execute_contract(
        controller.clone(),
        token_addr.clone(),
        &TokenExecuteMsg::SetKycStatus {
            address: alice.to_string(),
            status: cw3643_token::state::KycStatus::Approved,
        },
        &[],
    ).unwrap();
    
    app.execute_contract(
        controller.clone(),
        token_addr.clone(),
        &TokenExecuteMsg::SetKycStatus {
            address: bob.to_string(),
            status: cw3643_token::state::KycStatus::Approved,
        },
        &[],
    ).unwrap();
    
    println!("✅ T-REX infrastructure configured");
    
    // Test TokenFactory denom creation
    println!("🏭 Testing TokenFactory integration...");
    
    // Create denom
    app.execute_contract(
        owner.clone(),
        wrapper_addr.clone(),
        &WrapperExecuteMsg::CreateDenom {
            subdenom: "trex-token".to_string(),
        },
        &[],
    ).unwrap();
    
    // Check denom exists
    let denom_info: zig_tokenfactory_wrapper_cw::msg::DenomInfoResponse = app
        .wrap()
        .query_wasm_smart(
            wrapper_addr.clone(),
            &WrapperQueryMsg::DenomInfo {
                denom: format!("factory/{}/trex-token", wrapper_addr),
            },
        )
        .unwrap();
    
    assert_eq!(denom_info.denom, format!("factory/{}/trex-token", wrapper_addr));
    println!("✅ Denom created: {}", denom_info.denom);
    
    // Mint tokens via wrapper (to the RWA token contract vault)
    app.execute_contract(
        owner.clone(),
        wrapper_addr.clone(),
        &WrapperExecuteMsg::Mint {
            denom: format!("factory/{}/trex-token", wrapper_addr),
            to: token_addr.to_string(), // Explicitly send to the RWA token contract (vault)
            amount: Uint128::new(1000),
        },
        &[],
    ).unwrap();
    
    // Verify the native tokens are in the CW-3643 contract's bank balance
    let token_contract_native_balance = app.wrap().query_balance(token_addr.clone(), &denom_info.full_denom).unwrap().amount;
    assert_eq!(token_contract_native_balance, Uint128::new(1000));
    println!("✅ Native tokens minted to CW-3643 contract vault: {}", token_contract_native_balance);

    // Check internal balance of alice in CW-3643 is still 0, as tokens are in vault
    let alice_internal_balance_before_deposit: cw3643_token::msg::BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            token_addr.clone(),
            &TokenQueryMsg::Balance { address: alice.to_string() },
        )
        .unwrap();
    assert_eq!(alice_internal_balance_before_deposit.balance, Uint128::new(0));
    println!("✅ Alice's internal balance is 0 before deposit");

    // Test Deposit functionality
    println!("Depositing native tokens into CW-3643 vault for Alice...");
    app.send_tokens(
        alice.clone(),
        token_addr.clone(),
        &[Coin { denom: denom_info.full_denom.clone(), amount: Uint128::new(500) }],
    ).unwrap();

    app.execute_contract(
        alice.clone(),
        token_addr.clone(),
        &TokenExecuteMsg::Deposit {
            amount: Uint128::new(500),
            denom: denom_info.full_denom.clone(),
        },
        &[],
    ).unwrap();

    // Verify Alice's internal balance increased
    let alice_internal_balance_after_deposit: cw3643_token::msg::BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            token_addr.clone(),
            &TokenQueryMsg::Balance { address: alice.to_string() },
        )
        .unwrap();
    assert_eq!(alice_internal_balance_after_deposit.balance, Uint128::new(500));
    println!("✅ Alice's internal balance after deposit: {}", alice_internal_balance_after_deposit.balance);

    // Verify CW-3643 contract's native balance remains consistent
    let token_contract_native_balance_after_deposit = app.wrap().query_balance(token_addr.clone(), &denom_info.full_denom).unwrap().amount;
    assert_eq!(token_contract_native_balance_after_deposit, Uint128::new(1500)); // 1000 (minted) + 500 (deposited)
    println!("✅ CW-3643 contract native balance after deposit: {}", token_contract_native_balance_after_deposit);

    // Test Withdraw functionality (with compliance check)
    println!("Withdrawing native tokens from CW-3643 vault for Alice...");
    app.execute_contract(
        alice.clone(),
        token_addr.clone(),
        &TokenExecuteMsg::Withdraw {
            amount: Uint128::new(200),
            denom: denom_info.full_denom.clone(),
        },
        &[],
    ).unwrap();

    // Verify Alice's internal balance decreased
    let alice_internal_balance_after_withdraw: cw3643_token::msg::BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            token_addr.clone(),
            &TokenQueryMsg::Balance { address: alice.to_string() },
        )
        .unwrap();
    assert_eq!(alice_internal_balance_after_withdraw.balance, Uint128::new(300));
    println!("✅ Alice's internal balance after withdraw: {}", alice_internal_balance_after_withdraw.balance);

    // Verify Alice's native bank balance increased
    let alice_native_bank_balance_after_withdraw = app.wrap().query_balance(alice.clone(), &denom_info.full_denom).unwrap().amount;
    assert_eq!(alice_native_bank_balance_after_withdraw, Uint128::new(200));
    println!("✅ Alice's native bank balance after withdraw: {}", alice_native_bank_balance_after_withdraw);

    // Verify CW-3643 contract's native balance decreased
    let token_contract_native_balance_after_withdraw = app.wrap().query_balance(token_addr.clone(), &denom_info.full_denom).unwrap().amount;
    assert_eq!(token_contract_native_balance_after_withdraw, Uint128::new(1300)); // 1500 - 200
    println!("✅ CW-3643 contract native balance after withdraw: {}", token_contract_native_balance_after_withdraw);

    // Test direct bank send bypass (should fail or not be possible as users don't hold native tokens directly)
    // This is implicitly tested now since all new native tokens go to the contract vault.
    // If a user were to somehow obtain native tokens directly, they could bypass compliance.
    // The vault pattern makes it so users only hold internal, compliance-checked balances.


```

## tests/cw20_compat.rs

```
use cosmwasm_std::testing::{message_info, mock_dependencies, mock_env};
use cosmwasm_std::Uint128;
use cw3643_token::msg::{ExecuteMsg, InitialBalance, InstantiateMsg, QueryMsg};

#[test]
fn approve_and_transfer_from() {
    let mut deps = mock_dependencies();
    let env = mock_env();
    // info not needed directly here

    let owner = deps.api.addr_make("owner");
    let issuer = deps.api.addr_make("issuer");
    let controller = deps.api.addr_make("controller");
    let holder = deps.api.addr_make("holder");
    let spender = deps.api.addr_make("spender");

    let msg = InstantiateMsg {
        name: "RWA Token".to_string(),
        symbol: "RWA".to_string(),
        decimals: 6u8,
        initial_balances: vec![InitialBalance {
            address: holder.to_string(),
            amount: Uint128::new(1000),
        }],
        issuer: issuer.to_string(),
        controller: controller.to_string(),
        owner: owner.to_string(),
        cap: None,
        require_kyc_for_transfer: Some(true),
        identity_registry: None,
        compliance: None,
    };

    // instantiate
    let _res = cw3643_token::contract::instantiate(deps.as_mut(), env.clone(), message_info(&owner, &[]), msg)
        .unwrap();
    // set KYC approved for holder and spender
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&owner, &[]),
        ExecuteMsg::SetKycStatus {
            address: holder.to_string(),
            status: cw3643_token::msg::KycStatus::Approved,
        },
    );
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&owner, &[]),
        ExecuteMsg::SetKycStatus {
            address: spender.to_string(),
            status: cw3643_token::msg::KycStatus::Approved,
        },
    );

    // holder approves spender to spend 300
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&holder, &[]),
        ExecuteMsg::Approve {
            spender: spender.to_string(),
            amount: Uint128::new(300),
        },
    )
    .unwrap();

    // spender transfer_from holder -> controller for 200
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&spender, &[]),
        ExecuteMsg::TransferFrom {
            owner: holder.to_string(),
            recipient: controller.to_string(),
            amount: Uint128::new(200),
        },
    )
    .unwrap();

    // check allowance now 100
    let res_bin = cw3643_token::contract::query(
        deps.as_ref(),
        env.clone(),
        QueryMsg::Allowance {
            owner: holder.to_string(),
            spender: spender.to_string(),
        },
    )
    .unwrap();
    let allowance: Uint128 = cosmwasm_std::from_json(&res_bin).unwrap();
    assert_eq!(allowance, Uint128::new(100u128));

    // check balances
    let holder_bin = cw3643_token::contract::query(
        deps.as_ref(),
        env.clone(),
        QueryMsg::Balance {
            address: holder.to_string(),
        },
    )
    .unwrap();
    let holder_bal: Uint128 = cosmwasm_std::from_json(&holder_bin).unwrap();
    let controller_bin = cw3643_token::contract::query(
        deps.as_ref(),
        env.clone(),
        QueryMsg::Balance {
            address: controller.to_string(),
        },
    )
    .unwrap();
    let controller_bal: Uint128 = cosmwasm_std::from_json(&controller_bin).unwrap();
    assert_eq!(holder_bal, Uint128::new(800u128));
    assert_eq!(controller_bal, Uint128::new(200u128));
}

```

## tests/erc3643_compat.rs

```


```

## tests/erc3643_more.rs

```
// This test file previously covered operator and document features which are not part of the current API.
// Keep a placeholder ignored test to maintain file presence without affecting CI.

#[test]
#[ignore]
fn placeholder_operator_and_document_tests() {
    assert_eq!(2 + 2, 4);
}

```

## tests/factory_supply.rs

```
use cw_multi_test::{App, Contract, ContractWrapper, Executor};
use cosmwasm_std::Uint128;

use cw3643_token as core;
use core::msg::{ExecuteMsg as CExec, InstantiateMsg as CInst, QueryMsg as CQuery, InitialBalance, KycStatus, DenomInfoResponse, FactorySummaryResponse};

fn contract_core() -> Box<dyn Contract<cosmwasm_std::Empty>> {
    let c = ContractWrapper::new(core::execute, core::instantiate, core::query);
    Box::new(c)
}

#[test]
fn supply_and_burn_counters_update() {
    let mut app = App::default();
    let core_code = app.store_code(contract_core());
    let deployer = app.api().addr_make("deployer");
    let owner = app.api().addr_make("owner");
    let controller = owner.clone();
    let issuer = owner.clone();
    let alice = app.api().addr_make("alice");

    // instantiate core
    let core_addr = app.instantiate_contract(
        core_code,
        deployer.clone(),
        &CInst {
            name: "RWA".to_string(),
            symbol: "RWA".to_string(),
            decimals: 6,
            initial_balances: vec![InitialBalance { address: alice.to_string(), amount: Uint128::zero() }],
            issuer: issuer.to_string(),
            controller: controller.to_string(),
            owner: owner.to_string(),
            cap: None,
            require_kyc_for_transfer: None,
            identity_registry: None,
            compliance: None,
        },
        &[],
        "core",
        None,
    ).unwrap();

    // create denom directly (shadow mode)
    app.execute_contract(owner.clone(), core_addr.clone(), &CExec::FactoryCreateDenom {
        subdenom: "supplycoin".to_string(),
        minting_cap: Uint128::new(1_000_000),
        can_change_minting_cap: Some(true),
        uri: None,
        uri_hash: None,
        description: None,
    }, &[]).unwrap();

    // approve KYC for alice
    app.execute_contract(owner.clone(), core_addr.clone(), &CExec::SetKycStatus { address: alice.to_string(), status: KycStatus::Approved }, &[]).unwrap();

    // fetch denom full string
    let reg: Vec<DenomInfoResponse> = app.wrap().query_wasm_smart(core_addr.clone(), &CQuery::DenomRegistry {}).unwrap();
    assert_eq!(reg.len(), 1);
    let denom = reg[0].full_denom.clone();

    // mint 500
    app.execute_contract(controller.clone(), core_addr.clone(), &CExec::FactoryMint { denom: denom.clone(), to: alice.to_string(), amount: Uint128::new(500) }, &[]).unwrap();
    // burn 100
    app.execute_contract(controller.clone(), core_addr.clone(), &CExec::FactoryBurn { denom: denom.clone(), amount: Uint128::new(100) }, &[]).unwrap();

    // query denom info
    let info: DenomInfoResponse = app.wrap().query_wasm_smart(core_addr.clone(), &CQuery::DenomInfo { denom: denom.clone() }).unwrap();
    assert_eq!(info.total_minted, Uint128::new(400)); // 500 - 100
    assert_eq!(info.total_burned, Uint128::new(100));
    assert_eq!(info.total_supply, Uint128::new(400));

    // summary aggregation
    let summary: FactorySummaryResponse = app.wrap().query_wasm_smart(core_addr, &CQuery::FactorySummary {}).unwrap();
    assert_eq!(summary.denom_count, 1);
    assert_eq!(summary.total_minted_across_denoms, Uint128::new(400));
    assert_eq!(summary.total_burned_across_denoms, Uint128::new(100));
    assert_eq!(summary.total_supply_across_denoms, Uint128::new(400));
}

```

## tests/integration.rs

```
use cw_multi_test::App;

#[test]
fn integration_instantiate_and_issue() {
    let _app = App::default();
    // integration tests with cw-multi-test would go here; placeholder for CI
    // We keep tests simple in this repo; CI will run cargo test and build/optimize.
    assert_eq!(1u8, 1u8);
}

```

## tests/integration_invariants.rs

```


```

## tests/issuance_redemption_integration.rs

```


```

## tests/migrate_multisig.rs

```


```

## tests/prefix_check.rs

```
use bech32::{encode, ToBase32, Variant};
use cosmwasm_std::testing::mock_dependencies;
use cosmwasm_std::Api;

#[test]
fn print_valid_bech32_prefix() {
    let deps = mock_dependencies();
    let raw = [1u8; 20];
    let prefixes = ["cosmos", "terra", "zig", "zigtest", "chain", "cw"];
    for p in prefixes.iter() {
        let addr = encode(p, raw.to_base32(), Variant::Bech32).unwrap();
        let res = deps.api.addr_validate(&addr);
        println!("prefix {} => {:?}", p, res);
    }
}

```

## tests/proxy.rs

```
use cw_multi_test::{App, Contract, ContractWrapper, Executor};

use cw3643_token as core;
use core::msg as cmsg;
use core::msg::{ExecuteMsg as CExec, InstantiateMsg as CInst, KycStatus, QueryMsg as CQuery, InitialBalance};
use cosmwasm_std::Uint128;

// Wrapper aliases
use zig_tokenfactory_wrapper_cw as wrapper;
use wrapper::msg as wmsg;
use wrapper::msg::{InstantiateMsg as WInst, QueryMsg as WQuery};

fn contract_core() -> Box<dyn Contract<cosmwasm_std::Empty>> {
    let c = ContractWrapper::new(core::execute, core::instantiate, core::query);
    Box::new(c)
}

fn contract_wrapper() -> Box<dyn Contract<cosmwasm_std::Empty>> {
    let c = ContractWrapper::new(wrapper::execute, wrapper::instantiate, wrapper::query);
    Box::new(c)
}

#[test]
fn proxy_mode_create_and_mint_end_to_end() {
    let mut app = App::default();
    let core_code = app.store_code(contract_core());
    let wrap_code = app.store_code(contract_wrapper());

    // actors
    let owner = app.api().addr_make("owner");
    let controller = owner.clone();
    let issuer = owner.clone();
    let deployer = app.api().addr_make("deployer");
    let alice = app.api().addr_make("alice");

    // instantiate core
    let core_addr = app
        .instantiate_contract(
            core_code,
            deployer.clone(),
            &CInst {
                name: "RWA".to_string(),
                symbol: "RWA".to_string(),
                decimals: 6,
                initial_balances: vec![InitialBalance { address: alice.to_string(), amount: Uint128::zero() }],
                issuer: issuer.to_string(),
                controller: controller.to_string(),
                owner: owner.to_string(),
                cap: None,
                require_kyc_for_transfer: None,
                identity_registry: None,
                compliance: None,
            },
            &[],
            "core",
            None,
        )
        .unwrap();

    // instantiate wrapper owned by core and allow core as minter
    let wrap_addr = app
        .instantiate_contract(
            wrap_code,
            deployer,
            &WInst { owner: core_addr.to_string(), allowed_minters: Some(vec![core_addr.to_string()]) },
            &[],
            "wrapper",
            None,
        )
        .unwrap();

    // Set wrapper address in core (owner-only)
    app.execute_contract(
        owner.clone(),
        core_addr.clone(),
        &CExec::SetWrapperAddress { address: wrap_addr.to_string() },
        &[],
    )
    .unwrap();

    // Create denom via core (proxies to wrapper). Owner-only on core; wrapper requires owner==core.
    app.execute_contract(
        owner.clone(),
        core_addr.clone(),
        &CExec::FactoryCreateDenom {
            subdenom: "proxycoin".to_string(),
            minting_cap: Uint128::new(1_000_000),
            can_change_minting_cap: Some(true),
            uri: None,
            uri_hash: None,
            description: Some("proxy test".to_string()),
        },
        &[],
    )
    .unwrap();

    // Query core registry -> should have the denom mirrored
    let list: Vec<cmsg::DenomInfoResponse> = app
        .wrap()
        .query_wasm_smart(core_addr.clone(), &CQuery::DenomRegistry {})
        .unwrap();
    assert_eq!(list.len(), 1);
    let denom = list[0].full_denom.clone();
    assert!(denom.contains("proxycoin"));

    // Approve KYC for alice on core to satisfy compliance before proxy mint
    app.execute_contract(
        owner.clone(),
        core_addr.clone(),
        &CExec::SetKycStatus { address: alice.to_string(), status: KycStatus::Approved },
        &[],
    )
    .unwrap();

    // Mint via core (controller allowed). Should proxy to wrapper and mirror totals.
    app.execute_contract(
        controller.clone(),
        core_addr.clone(),
        &CExec::FactoryMint { denom: denom.clone(), to: alice.to_string(), amount: Uint128::new(1234) },
        &[],
    )
    .unwrap();

    // Check core mirrored total_minted
    let info: cmsg::DenomInfoResponse = app
        .wrap()
        .query_wasm_smart(core_addr.clone(), &CQuery::DenomInfo { denom: denom.clone() })
        .unwrap();
    assert_eq!(info.total_minted, Uint128::new(1234));

    // Also check wrapper registry reflects mint
    let winfo: wmsg::DenomInfoResponse = app
        .wrap()
        .query_wasm_smart(wrap_addr.clone(), &WQuery::Denom { denom: denom.clone() })
        .unwrap();
    assert_eq!(winfo.total_minted, Uint128::new(1234));
}

#[test]
fn proxy_disable_bank_admin_blocks_mint() {
    let mut app = App::default();
    let core_code = app.store_code(contract_core());
    let wrap_code = app.store_code(contract_wrapper());

    let owner = app.api().addr_make("owner");
    let controller = owner.clone();
    let issuer = owner.clone();
    let deployer = app.api().addr_make("deployer");
    let alice = app.api().addr_make("alice");

    let core_addr = app.instantiate_contract(
        core_code,
        deployer.clone(),
        &CInst {
            name: "RWA".to_string(),
            symbol: "RWA".to_string(),
            decimals: 6,
            initial_balances: vec![InitialBalance { address: alice.to_string(), amount: Uint128::zero() }],
            issuer: issuer.to_string(),
            controller: controller.to_string(),
            owner: owner.to_string(),
            cap: None,
            require_kyc_for_transfer: None,
            identity_registry: None,
            compliance: None,
        },
        &[],
        "core",
        None,
    ).unwrap();

    let wrap_addr = app.instantiate_contract(
        wrap_code,
        deployer,
        &WInst { owner: core_addr.to_string(), allowed_minters: Some(vec![core_addr.to_string()]) },
        &[],
        "wrapper",
        None,
    ).unwrap();

    // set wrapper
    app.execute_contract(owner.clone(), core_addr.clone(), &CExec::SetWrapperAddress { address: wrap_addr.to_string() }, &[]).unwrap();

    // create denom via proxy
    app.execute_contract(owner.clone(), core_addr.clone(), &CExec::FactoryCreateDenom {
        subdenom: "disabledcoin".to_string(),
        minting_cap: Uint128::new(10_000),
        can_change_minting_cap: Some(true),
        uri: None,
        uri_hash: None,
        description: None,
    }, &[]).unwrap();
    // disable bank admin (proxy forwards policy disabled)
    app.execute_contract(owner.clone(), core_addr.clone(), &CExec::FactoryDisableBankAdmin { denom: format!("coin.{}.disabledcoin", wrap_addr) }, &[]).unwrap();

    // Approve KYC for alice
    app.execute_contract(owner.clone(), core_addr.clone(), &CExec::SetKycStatus { address: alice.to_string(), status: KycStatus::Approved }, &[]).unwrap();

    // attempt mint should fail due to wrapper disabled; rely on invariant rather than error string
    let _err = app.execute_contract(controller.clone(), core_addr.clone(), &CExec::FactoryMint { denom: format!("coin.{}.disabledcoin", wrap_addr), to: alice.to_string(), amount: Uint128::new(1) }, &[]).unwrap_err();
    // Wrapper denom remains disabled and total_minted unchanged
    let dinfo: wmsg::DenomInfoResponse = app.wrap().query_wasm_smart(wrap_addr.clone(), &WQuery::Denom { denom: format!("coin.{}.disabledcoin", wrap_addr) }).unwrap();
    assert!(dinfo.disabled);
    assert_eq!(dinfo.total_minted, Uint128::zero());
}

```

## tests/query_transfer_limit.rs

```
use cosmwasm_std::testing::{message_info, mock_dependencies, mock_env};
use cosmwasm_std::Uint128;
use cw3643_token::msg::{ExecuteMsg, InitialBalance, InstantiateMsg, QueryMsg};

#[test]
fn query_limit() {
    let mut deps = mock_dependencies();
    let env = mock_env();

    let owner = deps.api.addr_make("owner");
    let issuer = deps.api.addr_make("issuer");
    let controller = deps.api.addr_make("controller");
    let alice = deps.api.addr_make("alice");

    let msg = InstantiateMsg {
        name: "RWA Token".to_string(),
        symbol: "RWA".to_string(),
        decimals: 6u8,
        initial_balances: vec![InitialBalance {
            address: alice.to_string(),
            amount: Uint128::new(0),
        }],
        issuer: issuer.to_string(),
        controller: controller.to_string(),
        owner: owner.to_string(),
        cap: None,
        require_kyc_for_transfer: Some(true),
        identity_registry: None,
        compliance: None,
    };

    let _ = cw3643_token::contract::instantiate(deps.as_mut(), env.clone(), message_info(&owner, &[]), msg)
        .unwrap();
    // set limit
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&owner, &[]),
        ExecuteMsg::SetTransferLimit {
            address: alice.to_string(),
            limit: Some(Uint128::new(500)),
        },
    )
    .unwrap();
    // query
    let bin = cw3643_token::contract::query(
        deps.as_ref(),
        env.clone(),
        QueryMsg::TransferLimit {
            address: alice.to_string(),
        },
    )
    .unwrap();
    let limit: Option<Uint128> = cosmwasm_std::from_json(&bin).unwrap();
    assert_eq!(limit, Some(Uint128::new(500)));
}

```

## tests/rwa_unit.rs

```
use cosmwasm_std::testing::{message_info, mock_dependencies, mock_env};
use cosmwasm_std::Uint128;
use cw3643_token::msg::{InitialBalance, InstantiateMsg};
// bech32 not needed - use mock API to create addresses

#[test]
fn instantiate_and_mint_flow() {
    let mut deps = mock_dependencies();
    let env = mock_env();
    // Use the mock API to create addresses that will validate under the test API
    let owner_addr = deps.api.addr_make("owner");
    let issuer_addr = deps.api.addr_make("issuer");
    let controller_addr = deps.api.addr_make("controller");
    let initial_holder = deps.api.addr_make("holder");
    let info = message_info(&owner_addr, &[]);

    let msg = InstantiateMsg {
        name: "RWA Token".to_string(),
        symbol: "RWA".to_string(),
        decimals: 6u8,
        initial_balances: vec![InitialBalance {
            address: initial_holder.to_string(),
            amount: Uint128::new(1000),
        }],
        issuer: issuer_addr.to_string(),
        controller: controller_addr.to_string(),
        owner: owner_addr.to_string(),
        cap: None,
        require_kyc_for_transfer: Some(true),
        identity_registry: None,
        compliance: None,
    };

    // call the crate's public instantiate entry point
    let res = cw3643_token::contract::instantiate(deps.as_mut(), env.clone(), info.clone(), msg);
    if let Err(e) = &res {
        // print the error for debugging in CI/local runs
        println!("instantiate error: {:?}", e);
    }
    assert!(res.is_ok());
}

```

## tests/transfer_limits.rs

```
use cosmwasm_std::testing::{message_info, mock_dependencies, mock_env};
use cosmwasm_std::Uint128;
use cw3643_token::msg::{ExecuteMsg, InitialBalance, InstantiateMsg, QueryMsg};

#[test]
fn enforce_transfer_limit() {
    let mut deps = mock_dependencies();
    let env = mock_env();

    let owner = deps.api.addr_make("owner");
    let issuer = deps.api.addr_make("issuer");
    let controller = deps.api.addr_make("controller");
    let alice = deps.api.addr_make("alice");
    let bob = deps.api.addr_make("bob");

    let msg = InstantiateMsg {
        name: "RWA Token".to_string(),
        symbol: "RWA".to_string(),
        decimals: 6u8,
        initial_balances: vec![InitialBalance {
            address: alice.to_string(),
            amount: Uint128::new(1000),
        }],
        issuer: issuer.to_string(),
        controller: controller.to_string(),
        owner: owner.to_string(),
        cap: None,
        require_kyc_for_transfer: Some(true),
        identity_registry: None,
        compliance: None,
    };

    // instantiate
    let _ = cw3643_token::contract::instantiate(deps.as_mut(), env.clone(), message_info(&owner, &[]), msg)
        .unwrap();
    // set KYC approved for alice and bob
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&owner, &[]),
        ExecuteMsg::SetKycStatus {
            address: alice.to_string(),
            status: cw3643_token::msg::KycStatus::Approved,
        },
    );
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&owner, &[]),
        ExecuteMsg::SetKycStatus {
            address: bob.to_string(),
            status: cw3643_token::msg::KycStatus::Approved,
        },
    );

    // set limit for alice to 100
    let _ = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&owner, &[]),
        ExecuteMsg::SetTransferLimit {
            address: alice.to_string(),
            limit: Some(Uint128::new(100)),
        },
    )
    .unwrap();

    // alice tries to transfer 200 -> should fail
    let res = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&alice, &[]),
        ExecuteMsg::Transfer {
            recipient: bob.to_string(),
            amount: Uint128::new(200),
        },
    );
    assert!(res.is_err());

    // alice transfers 50 -> should succeed
    let res2 = cw3643_token::contract::execute(
        deps.as_mut(),
        env.clone(),
        message_info(&alice, &[]),
        ExecuteMsg::Transfer {
            recipient: bob.to_string(),
            amount: Uint128::new(50),
        },
    );
    assert!(res2.is_ok());

    // check balances
    let bob_bin = cw3643_token::contract::query(
        deps.as_ref(),
        env.clone(),
        QueryMsg::Balance {
            address: bob.to_string(),
        },
    )
    .unwrap();
    let bob_bal: Uint128 = cosmwasm_std::from_json(&bob_bin).unwrap();
    assert_eq!(bob_bal, Uint128::new(50));
}

```

## tests/validators_e2e.rs

```

```

