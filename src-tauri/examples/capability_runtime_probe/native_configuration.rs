//! Experimental WebKit SPI. No production application imports this module.
use objc2::{class, msg_send, rc::Retained, runtime::{AnyObject, Bool, Sel}, sel, MainThreadMarker};
use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};
use serde_json::{json, Value};

unsafe fn supports(object: &AnyObject, selector: Sel) -> bool {
    let answer: Bool = msg_send![object, respondsToSelector: selector];
    answer.as_bool()
}

pub fn prepare(label: &str) -> (Retained<WKWebViewConfiguration>, bool, Value) {
    let main = MainThreadMarker::new().expect("configure WebKit on the main thread");
    unsafe {
        let config = WKWebViewConfiguration::new(main);
        // Wry deliberately ignores incognito/data-store options when supplied a configuration.
        config.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(main));
        let persistent = config.websiteDataStore().isPersistent();
        let preferences = config.preferences();
        let control = label == "probe-control";
        let available = [sel!(_setAllowedNetworkHosts:), sel!(_allowedNetworkHosts), sel!(_setLoadsSubresources:), sel!(_loadsSubresources)]
            .into_iter().all(|selector| supports(&config, selector))
            && [sel!(_setPeerConnectionEnabled:), sel!(_peerConnectionEnabled), sel!(_setDNSPrefetchingEnabled:), sel!(_dnsPrefetchingEnabled)]
                .into_iter().all(|selector| supports(&preferences, selector))
            && (label != "probe-unavailable" || supports(&config, sel!(_nookiProbeUnavailableControl:)));
        if !available {
            return (config, false, json!({"available": false, "persistentStore": persistent, "readyForPackageNavigation": false}));
        }
        if !control {
            let hosts: Retained<AnyObject> = msg_send![class!(NSSet), new];
            let _: () = msg_send![&config, _setAllowedNetworkHosts: &*hosts];
            let _: () = msg_send![&config, _setLoadsSubresources: Bool::NO];
            let _: () = msg_send![&preferences, _setPeerConnectionEnabled: Bool::NO];
            let _: () = msg_send![&preferences, _setDNSPrefetchingEnabled: Bool::NO];
        }
        let hosts: Option<Retained<AnyObject>> = msg_send![&config, _allowedNetworkHosts];
        let host_count = hosts.as_ref().map(|hosts| { let count: usize = msg_send![hosts, count]; count });
        let subresources: Bool = msg_send![&config, _loadsSubresources];
        let peer: Bool = msg_send![&preferences, _peerConnectionEnabled];
        let dns: Bool = msg_send![&preferences, _dnsPrefetchingEnabled];
        let ready = !persistent && peer.as_bool() == control && subresources.as_bool() == control
            && !dns.as_bool() && if control { host_count.is_none() } else { host_count == Some(0) };
        (config, ready, json!({"available": true, "persistentStore": persistent, "allowedNetworkHostCount": host_count,
            "loadsNetworkSubresources": subresources.as_bool(), "peerConnectionEnabled": peer.as_bool(),
            "dnsPrefetchEnabled": dns.as_bool(), "readyForPackageNavigation": ready}))
    }
}
