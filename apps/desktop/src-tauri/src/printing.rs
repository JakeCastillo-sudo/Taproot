use serialport::SerialPortType;
use std::time::Duration;

#[tauri::command]
pub fn list_serial_ports() -> Vec<String> {
  serialport::available_ports()
    .unwrap_or_default()
    .iter()
    .filter(|p| matches!(
      p.port_type, SerialPortType::UsbPort(_)
    ))
    .map(|p| p.port_name.clone())
    .collect()
}

#[tauri::command]
pub fn print_receipt_escpos(
  port_name: String,
  order_json: String,
) -> Result<(), String> {
  let order: serde_json::Value =
    serde_json::from_str(&order_json)
      .map_err(|e| format!("JSON error: {}", e))?;

  let mut port = serialport::new(&port_name, 9600)
    .timeout(Duration::from_millis(3000))
    .open()
    .map_err(|e| format!("Port error: {}", e))?;

  let cmds = build_receipt(&order);
  port.write_all(&cmds)
    .map_err(|e| format!("Print error: {}", e))?;

  Ok(())
}

#[tauri::command]
pub fn print_kitchen_ticket(
  port_name: String,
  order_json: String,
) -> Result<(), String> {
  let order: serde_json::Value =
    serde_json::from_str(&order_json)
      .map_err(|e| format!("JSON error: {}", e))?;

  let mut port = serialport::new(&port_name, 9600)
    .timeout(Duration::from_millis(3000))
    .open()
    .map_err(|e| format!("Port error: {}", e))?;

  let cmds = build_kitchen(&order);
  port.write_all(&cmds)
    .map_err(|e| format!("Print error: {}", e))?;

  Ok(())
}

#[tauri::command]
pub fn open_cash_drawer(
  port_name: String,
) -> Result<(), String> {
  let mut port = serialport::new(&port_name, 9600)
    .timeout(Duration::from_millis(1000))
    .open()
    .map_err(|e| format!("Drawer error: {}", e))?;

  // ESC/POS drawer kick: ESC p 0 25 250
  let kick: Vec<u8> = vec![0x1B, 0x70, 0x00, 0x19, 0xFA];
  port.write_all(&kick)
    .map_err(|e| format!("Kick error: {}", e))?;

  Ok(())
}

fn write_str(cmds: &mut Vec<u8>, s: &str) {
  cmds.extend_from_slice(s.as_bytes());
  cmds.push(0x0A); // newline
}

fn build_receipt(order: &serde_json::Value) -> Vec<u8> {
  let mut c: Vec<u8> = Vec::new();

  c.extend_from_slice(&[0x1B, 0x40]); // init
  c.extend_from_slice(&[0x1B, 0x61, 0x01]); // center
  c.extend_from_slice(&[0x1D, 0x21, 0x11]); // double

  let name = order["locationName"]
    .as_str().unwrap_or("Restaurant");
  write_str(&mut c, name);

  c.extend_from_slice(&[0x1D, 0x21, 0x00]); // normal
  c.extend_from_slice(&[0x1B, 0x61, 0x00]); // left

  let order_num = order["orderNumber"]
    .as_str().unwrap_or("???");
  write_str(&mut c, &format!("Order #{}", order_num));

  write_str(&mut c, &"=".repeat(32));

  if let Some(items) = order["items"].as_array() {
    for item in items {
      let qty = item["quantity"].as_u64().unwrap_or(1);
      let name = item["name"].as_str().unwrap_or("Item");
      let total = item["total"].as_u64().unwrap_or(0);
      let price = format!("${:.2}", total as f64 / 100.0);
      let left = format!("{}x {}", qty, name);
      let pad = 32usize.saturating_sub(
        left.len() + price.len()
      );
      write_str(&mut c,
        &format!("{}{}{}", left, " ".repeat(pad), price));
    }
  }

  write_str(&mut c, &"=".repeat(32));

  let total = order["total"].as_u64().unwrap_or(0);
  c.extend_from_slice(&[0x1D, 0x21, 0x11]);
  write_str(&mut c,
    &format!("TOTAL: ${:.2}", total as f64 / 100.0));
  c.extend_from_slice(&[0x1D, 0x21, 0x00]);

  c.extend_from_slice(&[0x1B, 0x61, 0x01]);
  write_str(&mut c, "");
  write_str(&mut c, "Thank you!");
  write_str(&mut c, "");
  write_str(&mut c, "");

  c.extend_from_slice(&[0x1D, 0x56, 0x01]); // cut
  c
}

fn build_kitchen(order: &serde_json::Value) -> Vec<u8> {
  let mut c: Vec<u8> = Vec::new();

  c.extend_from_slice(&[0x1B, 0x40]);
  c.extend_from_slice(&[0x1B, 0x61, 0x01]);
  c.extend_from_slice(&[0x1D, 0x21, 0x11]);
  write_str(&mut c, "*** KITCHEN ***");

  let order_num = order["orderNumber"]
    .as_str().unwrap_or("???");
  write_str(&mut c, &format!("#{}", order_num));

  c.extend_from_slice(&[0x1D, 0x21, 0x00]);
  c.extend_from_slice(&[0x1B, 0x61, 0x00]);
  write_str(&mut c, &"=".repeat(32));

  if let Some(items) = order["items"].as_array() {
    for item in items {
      let qty = item["quantity"].as_u64().unwrap_or(1);
      let name = item["name"].as_str().unwrap_or("Item");
      c.extend_from_slice(&[0x1D, 0x21, 0x11]);
      write_str(&mut c,
        &format!("{}x {}", qty, name.to_uppercase()));
      c.extend_from_slice(&[0x1D, 0x21, 0x00]);

      if let Some(mods) = item["modifiers"].as_array() {
        for m in mods {
          let mname = m["name"].as_str().unwrap_or("");
          write_str(&mut c,
            &format!("  >> {}", mname.to_uppercase()));
        }
      }
    }
  }

  write_str(&mut c, &"=".repeat(32));
  write_str(&mut c, "*** END ***");
  write_str(&mut c, "");
  write_str(&mut c, "");

  c.extend_from_slice(&[0x1D, 0x56, 0x01]);
  c
}
