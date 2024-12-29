import { v2 as cloudinary } from "cloudinary";
import fs from "fs";


// Configuration
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadOnCloudinary = async (localFilePath) => {
    try {
        if(!localFilePath) return null;
 
        // upload the file on cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
        })
        // file has been uploaded succesfully
        // console.log("File is uploaded on cloudinary:", response.url);
        fs.unlinkSync(localFilePath);
        return response;
    } catch (error) {
        fs.unlinkSync(localFilePath) // remove the locally saved temporarry file as the upload failed
        return null;
    }
}

/**
 * Utility function to delete a file from Cloudinary
 * @param {string} fileUrl - The URL of the file to delete
*/

const deleteFileOnCloudinary = async (fileUrl) => {
    try {
        // Extract the public ID from the file URL
        // EXAMPLE: https://res.cloudinary.com/prajwalhole/image/upload/v1735132843/xvyk8oxzrjvjfirio7r7.jpg
        const publicId = fileUrl.split('/').pop().split(".")[0];

        // Delete the file from Cloudinary
        await cloudinary.uploader.destroy(publicId);
        
    } catch (error) {
        throw new ApiError(400, "Failed to Delete File")
    }
}


export { 
    uploadOnCloudinary,
    deleteFileOnCloudinary
 };