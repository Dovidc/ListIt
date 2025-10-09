import Foundation
import CoreData

@objc(CachedListing)
final class CachedListing: NSManagedObject {
    @NSManaged var id: String
    @NSManaged var title: String
    @NSManaged var subtitle: String?
    @NSManaged var updatedAt: Date
}

extension CachedListing {
    @nonobjc class func fetchRequest() -> NSFetchRequest<CachedListing> {
        NSFetchRequest<CachedListing>(entityName: "CachedListing")
    }
}
