const router = require("express").Router();

//paths
const user = require("./user");
const detection = require("./detection");

// routes
router.use("/user", user);
router.use("/detect", detection);


module.exports = router;
