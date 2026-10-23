// Tests and the eval never wait for a shared lane to Crossref or CORE (src/gate). The gate's own tests call resetGates() to turn it on.
import { gatesOff } from "./src/gate";

gatesOff();
