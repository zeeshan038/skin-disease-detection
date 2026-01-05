//NPM Packages
const router = require("express").Router();

const { detectSkin, getUserActivity, getDashboardStats } = require("../controllers/detection");

const verifyUser = require("../middlewares/verifyUser");
const upload = require("../utils/multer");


//middleware
router.use(verifyUser);

router.post('/skin-detection', upload.single('image'), detectSkin);
router.get('/users-activity', getUserActivity);
router.get('/dashboard-stats', getDashboardStats);

module.exports = router;
