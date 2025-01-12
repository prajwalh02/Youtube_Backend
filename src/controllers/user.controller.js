import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js"
import { uploadOnCloudinary, deleteFileOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from 'jsonwebtoken';
import mongoose from "mongoose";


const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false })

        return {accessToken, refreshToken}

    } catch (error) {
        throw new ApiError(500, "Something Went wrong while generating refresh and access token" )
    }
}

const registerUser = asyncHandler( async (req, res) => {
    
    // if data if coming from form/json then req.body
    const {fullName, email, userName, password} = req.body;
    // console.log(req.body);
    
/*
    if(fullName === "") {
        throw new ApiError(400, "FullName is required")
    } 
*/

    // instead of above line we can use another method for validation
    if(
        [fullName, email, userName, password].some((field) => field?.trim() === "")
    ) {
        throw new ApiError(400, "All fields are required")
    }

    const existedUser = await User.findOne({
        $or: [{ userName },{ email }]
    }) 

    if(existedUser) {
        throw new ApiError(409, "User with email or username already exists")
    }

    // upload them to cloudinary
    const avatarLocalPath = req.files?.avatar[0]?.path; 
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;
    
    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is a required")
    }

    // upload on cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if(!avatar) {        
        throw new ApiError(400, "Avatar file is required")
    }    

    // create user object - create entry in db
    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        userName: userName.toLowerCase()
    })

    // remove password and refresh token field from response
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    // check for user creation
    if(!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user")
    }

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User Registered successfully") 
    )

 
})

const loginUser = asyncHandler( async (req, res) => {

    // req.body -> data
    const {email, userName, password} = req.body

    // username or email
    if(!userName && !email) {
        throw new ApiError(400, "username or email required")
    }

    // find the user
    const user = await User.findOne({
        $or: [{userName}, {email}]
    })

    if(!user) {
        throw new ApiError(400, "User does not exist")
    }

    // password check
    const isPasswordValid = await user.isPasswordCorrect(password)
    
    if(!isPasswordValid) {
        throw new ApiError(401, "Invalid user Credentials")
    }

    // access and refresh token
    const {accessToken, refreshToken} = await generateAccessAndRefreshToken(user._id);

    // Exclude sensitive Data
    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    // Set Cookies for Tokens
    const options = {
        httpOnly: true,      // only the server can access/modified the cookie
        secure: true        // cookie will be sent over https
    }    

    // send cookie
    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "User logged In Successfully"
        )
    )
})

const logoutUser = asyncHandler(async(req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,      // only the server can access/modified the cookie
        secure: true        // cookie will be sent over https
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(
        new ApiResponse(
            200, 
            {},
            "User logged out Successfully"
        )
    )
})

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized Request")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
    
        const user = await User.findById(decodedToken?._id)
    
        if(!user) {
            throw new ApiError(401, "Invalid Refresh Token")
        }
    
        // checked if incoming refresh token and user's refresh token (which is saved in db) are same
        if(incomingRefreshToken !== user.refreshToken) {
            throw new ApiError(401, "Refresh Token is expired or used")
        }
    
        const options = {
            httpOnly: true,    // only the server can access/modified the cookie
            secure: true       // cookie will be sent over https
        }
    
        const{accessToken, newRefreshToken} = await generateAccessAndRefreshToken(user._id)
    
        return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new ApiResponse(
                200, 
                {accessToken, refreshToken: newRefreshToken},
                "Access Token and Refresh Token refreshed successfully"
            )
        )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }

})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const {oldPassword, newPassword} = req.body;

    const user = await User.findById(req.user?._id);
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

    if(!isPasswordCorrect) {
        throw new ApiError(400, "Invalid Old Password");
    }

    user.password = newPassword;
    await user.save({validateBeforeSave: false});

    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password Changed Successfully"))

})

const getCurrentuser = asyncHandler(async(req, res) => {
    return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current User fetched Successfully"))
})

const updateAccountDetails = asyncHandler(async(req, res) => {
    // TODO: Need to update this method
    // FIXME: we should update the user with either with email or fullName
    const {fullName, email} = req.body;

    if(!fullName || !email) {
        throw new ApiError(400, "All fields are required")
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                fullName,
                email
            }
        },
        {new: true}    // Return the updated document
    ).select("-password ")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account Details Updated Successfully"))

})

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path

    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar File is missing")
    }

    // upload the new avatar to cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url) {
        throw new ApiError(400, "Error while uploading avatar")
    }

    // Fetch the current user and store the old avatar URL
    const currentUser = await User.findById(req.user?._id).select("avatar");

    if(!currentUser) {
         throw new ApiError(404, "User not found");
    }

    const oldAvatarUrl = currentUser.avatar;

    const updatedUser = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        {new: true}       // Return the updated document
    ).select("-password")

    // Delete the old avatar file from Cloudinary
    if(oldAvatarUrl) {
        await deleteFileOnCloudinary(oldAvatarUrl)
    }

    return res
    .status(200)
    .json(
        new ApiResponse(200, updatedUser, "Avatar updated successfully")
    )

})

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path
    
    if(!coverImageLocalPath) {
        throw new ApiError(400, "Cover Image File is missing")
    }

    // upload new coverImage to cloudinary
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url) {
        throw new ApiError(400, "Error while uploading cover image")
    }

    // Fetch the current user and store the old avatar URL
    const currentUser = await User.findById(req.user?._id).select("coverImage");

    if(!currentUser) {
         throw new ApiError(404, "User not found");
    }

    const oldCoverImageUrl = currentUser.coverImage;

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {new: true}        // Return the updated document
    ).select("-password")

    // Delete the old Cover Image file from Cloudinary
    if(oldCoverImageUrl) {
        await deleteFileOnCloudinary(oldCoverImageUrl)
    }

    return res
    .status(200)
    .json(
        new ApiResponse(200, user, "Cover Image updated successfully")
    )
})

const getUserChannelProfile = asyncHandler(async(req, res) => {

    const {userName} = req.param

    if(!userName?.trim()){
        throw new ApiError(400, "UserName is missing")
    }

    const channel = await User.aggregate([
        {
            $match: {
                userName: userName?.toLowerCase()
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "$subscriptions.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
           $project: {
                fullName: 1,
                userName: 1,
                subscribersCount: 1,
                channelSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1
           } 
        }
    ])

    if(!channel?.length) {
        throw new ApiError(404, "Channel does not exist")
    }

    return res
    .status(200)
    .json(
        new ApiResponse(200, channel[0], "User Channel fetched SuccessFully")
    )
})

const getWatchHistory = asyncHandler(async(req, res) => {
    const user = await user.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        userName: 1,
                                        avatar: 1,
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields:{
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
    .status
    .json(
        new ApiResponse(
            200,
            user[0].watchHistory,
            "Watch History fetched successfully"
        )
    )
})

export {
    registerUser,
    loginUser, 
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentuser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
}