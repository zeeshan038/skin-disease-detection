//Model
const User = require("../models/User");

//NPM Packages
const bcrypt = require("bcrypt");
const dayjs = require("dayjs");

// Schemas
const {
  signupSchema,
  loginSchema,
  userSchema,
  passwordSchema,
} = require("../schema/User");

// Utils
const genrateToken = require("../utils/GenrateToken");
const { get4DigitCode } = require("../utils/method");
const { sendVerificationEmail } = require("../utils/mailer");

/**
 * @desciption Signup User
 * @route POST /api/user/signup
 * @access Public
 */
module.exports.signup = async (req, res) => {
  const payload = req.body;

  //Error Handling
  const result = signupSchema(payload);
  if (result.error) {
    const errors = result.error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: false,
      msg: errors,
    });
  }

  try {
    // Checking if user already exists
    const existingUser = await User.findOne({ email: payload.email });
    if (existingUser) {
      return res.status(400).json({
        status: false,
        msg: "User with this email already exists",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(payload.password, salt);

    //Creating user
    await User.create({
      name: payload.name,
      email: payload.email,
      password: hashedPassword,
      profileImg: payload.profileImg,
    });

    //Response
    return res.status(201).json({
      status: true,
      msg: "User Registered Successfully!",
    });
  } catch (error) {
    return res.status(500).json({
      errors: error.message,
    });
  }
};

/**
 * @desciption login user
 * @route POST /api/user/login
 * @access Public
 */
module.exports.login = async (req, res) => {
  const payload = req.body;
  console.log("payload",payload);
  //Error Handling
  const result = loginSchema(payload);
  if (result.error) {
    const errors = result.error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: false,
      msg: errors,
    });
  }

  try {
    //Checking valid user
    const validUser = await User.findOne({ email: payload.email }).select(
      "password"
    );
    if (!validUser) {
      return res.status(401).json({
        status: false,
        msg: "Email or Password is incorrect",
      });
    }

    //Checking password
    const validPassword = await bcrypt.compareSync(
      payload.password,
      validUser.password
    );
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        msg: "Email or Password is incorrect",
      });
    }

    const token = genrateToken(validUser._id);

    return res
      .status(200)
      .cookie("token", token, {
        httpOnly: true,
      })
      .json({
        status: true,
        message: "User Logged In Successfully!",
        id: validUser._id,
        token,
      });
  } catch (error) {
    return res.status(500).json({
      errors: error.message
    });
  }
};

/**ss
 * @desciption Forgot Password
 * @route POST /api/user/forgot-password
 * @access Public
 */
module.exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      status: false,
      msg: "Email is required",
    });
  } else {
    //Regex
    var mailformat = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    if (!email.match(mailformat)) {
      return res
        .status(400)
        .json({ msg: "Invalid email address", status: false });
    }
  }

  try {
    // Check if the user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        status: false,
        msg: "User not found",
      });
    }

    // Generate OTP
    const otp = get4DigitCode();

    // Save OTP and timestamp in the user's record
    user.verificationCode = otp;
    user.otpLastSentTime = dayjs().valueOf();
    await user.save();
    
    // Send OTP to user's email
    await sendVerificationEmail(email, otp);

    return res.status(200).json({
      status: true,
      msg: "OTP sent to your email. Please verify.",
      OTP: otp,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      errors: error,
    });
  }
};

/**
 *  @description Verify OTP
 *  @route PUT /api/user/verify-otp
 *  @access Public
 */
module.exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  //Error Handling
  if (!email || !otp) {
    return res.status(400).json({
      errors: {
        status: false,
        msg: "Email and OTP are required",
      },
    });
  }

  try {
    const user = await User.findOne({ email }).select(
      "+verificationCode +otpLastSentTime"
    );

    if (!user) {
      return res.status(400).json({
        status: false,
        msg: "User not found",
      });
    }
    
    // Checking otp
    if (!otp) {
      return res.status(400).json({
        errors: {
          status: false,
          msg: "OTP is missing",
        },
      });
    }
    if (
      dayjs().diff(dayjs(user.verificationCode)) > 30000 ||
      user.verificationCode == null ||
      user.otpLastSentTime == null
    ) {
      return res.status(400).json({
        status: false,
        msg: "OTP is expired or used",
      });
    }
    if (otp !== user.verificationCode) {
      return res.status(400).json({
        status: false,
        msg: "OTP is incorrect",
      });
    }

    await User.updateOne(
      { _id: user._id },
      {
        verificationCode: null,
        otpLastSentTime: null,
      }
    );

    return res.status(200).json({
      status: true,
      msg: "Account verified",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      errors: error,
    });
  }
};

/**
 * @desciption Reset Password
 * @route PUT /api/user/reset-password
 * @access Public
 */
module.exports.resetPassword = async (req, res) => {
  const { newPassword, confirmPassword } = req.body;
  const { email } = req.params;

  if (!newPassword || !confirmPassword) {
    return res.status(400).json({
      status: false,
      msg: "All fields are required",
    });
  }
  if (newPassword.length < 6 || confirmPassword.length < 6) {
    return res.status(400).json({
      status: false,
      msg: "Password must be greater than 6 characters",
    });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      status: false,
      msg: "Passwords do not match",
    });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        status: false,
        msg: "User not found",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await User.updateOne(
      { _id: user._id },
      {
        password: hashedPassword,
      }
    );

    return res.status(200).json({
      status: true,
      msg: "Password reset successfull",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      errors: error,
    });
  }
};

/**
 *  @description Change password
 *  @route PUT /api/user/change-password
 *  @access Private
 */
module.exports.changePassword = async (req, res) => {
  const { _id } = req.user;
  const payload = req.body;

  console.log("pay" , payload)

  //Error Handling
  const result = passwordSchema(payload);
  if (result.error) {
    const errors = result.error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: false,
      msg: errors,
    });
  }

  try {
    const user = await User.findById(_id).select("+password");

    if (!user) {
      return res.status(404).json({
        status: false,
        msg: "User not found",
      });
    }

    // Compare current password with the stored hashed password
    const matchPassword = await bcrypt.compare(payload.currentPassword, user.password);
    if (!matchPassword) {
      return res.status(400).json({
        status: false,
        msg: "Invalid Current Password",
      });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(payload.newPassword, salt);

    // Update the user's password
    await User.updateOne({ _id }, { password: hashedPassword });

    return res.status(200).json({
      status: true,
      msg: "Password updated successfully",
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      errors: error.message,
    });
  }
};

/**
 *  @description Update Profile
 *  @route PUT /api/user/edit-profile
 *  @access Private
 */
module.exports.editProfile = async (req, res) => {
  const { _id } = req.user;
  const payload = req.body;

  const result = userSchema(payload);
  if (result.error) {
    const errors = (await result).error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: false,
      msg: errors,
    });
  }

  try {
    await User.updateOne({ _id }, { ...payload });

    return res.status(200).json({
      status: true,
      msg: "Profile Updated Successfully",
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      status: false,
      errors: error,
    });
  }
};

/**
 *  @description get user info
 *  @route GET /api/user/user-info
 *  @access Private
 */

module.exports.getUserInfo = async (req, res) => {
  const { _id } = req.user;

  try {
    const user = await User.findById(_id);
    if (!user) {
      return res.status(400).json({
        status: false,
        msg: "User not found",
      });
    }
    return res.status(200).json({
      status: true,
      userInfo: user,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      errors: error.message,
    });
  }
};

/**
 *  @description delete user
 *  @route PUT /api/user/delete-user
 *  @access Private
 */

module.exports.deleteUser = async (req, res) => {
  const { _id } = req.user;
  try {
    const user = await User.findByIdAndDelete(_id);
    if (!user) {
      return res.status(400).json({
        status: false,
        msg: "User not found",
      });
    }
    return res.status(200).json({
      status: true,
      msg: "User deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      errors: error.message,
    });
  }
};

/**
 *  @description add user profile image
 *  @route GET /api/user/upload image
 *  @access Private
 */

module.exports.uploadProfilePicture = async (req, res) => {
  const { _id } = req.user;

  try {
    if (!req.file) {
      return res.status(400).json({
        status: false,
        msg: "No file uploaded",
      });
    }
    const imgUrl = `http://uploads/${req.file.filename}`;

    const updatedUser = await User.findByIdAndUpdate(
      _id,
      { profileImage: imgUrl },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({
      message: "Profile picture uploaded successfully",
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      errors: error.message,
    });
  }
};

